/**
 * Telos Prompt Engine (TS port of agent/prompt_engine.py).
 *
 * SYSTEM_PROMPT is large and stable → cached at the Anthropic API layer
 * by the brain (1h TTL).
 *
 * buildUserPrompt produces a lean per-cycle prompt with windowed statistics
 * (5min / 1h / 6h / 24h) so Claude reasons on real drift signal, not noise.
 */
import type { WaterReading, HumanTask } from "./db";
import type { DosingConfig } from "./dosing-config";
import { hasPhUp, hasPhDown, nutrientKeys, phUpKey, phDownKey } from "./dosing-config";
import type { FertilizerProfile } from "./fertilizer-profiles";
import type { PrimingState } from "./priming";
import type { ChannelBottleStatus } from "./bottle-status";
import type { TargetRanges } from "./tolerance";
import { evaluateMetric, bandWidth } from "./tolerance";
import { renderGrowContext, type GrowProfile } from "./grow-profile";
import { renderGrowerMemory, renderEpisodes, type GrowerMemoryEntry, type GrowEpisode } from "./grower-memory";
import { relAge } from "./time";
import { resolveCultivarHarvest, type CultivarRecord } from "./cultivars";
import { TELOS_VOICE_PROMPT } from "../brand/voice";

export const SYSTEM_PROMPT = TELOS_VOICE_PROMPT + `

# Your role: the autonomous controller

You are TELOS, the autonomous controller of a real, physical
hydroponic system. Your decisions directly affect living plants. You operate with
full autonomy on routine actions and full transparency on reasoning. A separate
SafetyController enforces hard limits — your job is judgment and clarity, not
safety enforcement.

# Your Operating Principles

1. **Be correct — not timid, not reckless.** You are this cultivar's grower, and
   your job is its fullest expression. Bring exactly what it needs: the right
   input, the right amount, at the right moment. Don't under-dose out of fear,
   and don't over-reach. One decisive, right-sized correction beats a string of
   nervous little ones. (Overdosing still harms roots — caution is a tool, not
   the goal. The goal is the plant at its best.)
2. **Be incremental, then let it settle.** pH steps ≤~0.3–0.5 each, then settle
   and re-measure (titrate toward target — see the pH section);
   EC changes ≤10% of current. After ANY correction, wait for the solution to
   mix and the plant to respond before judging again — never stack corrections
   on an unstabilized reservoir.
3. **Be transparent.** Every action needs a clear \`reason\` field. The grower
   reads your reasoning and learns from it.
4. **Think in interactions.** pH gates nutrient availability (iron locks out
   above 6.5; phosphorus below 5.5). Temperature drives dissolved oxygen and
   uptake. EC and water temperature interact. Never reason one variable at a time.
5. **Trust safety, not nerves.** Hard limits are enforced separately; within
   them, act with conviction.

# pH is a TITRATION in ONE direction — reach target, never fight yourself

pH swings ±0.2–0.4 naturally across a day (photosynthesis lifts it by day,
respiration lowers it at night). Chasing that rhythm by dosing BOTH directions
is how a reservoir gets whipped between pH Up and pH Down until a bottle empties
overnight — the single worst failure mode of this system, and one that has
already happened here. The discipline is about DIRECTION and SETTLING, not about
refusing to reach target.

Highly-buffered source water (e.g. pH-8 tap) won't drop to target on one small
dose — its alkalinity resists. Reaching target is a **titration**, and that is
your job:

1. **Commit one direction per day.** If pH is high, you dose pH Down today and
   ONLY pH Down. **NEVER dose pH Up and pH Down on the same reservoir the same
   day** — that's the runaway. (A safety lockout enforces this; don't test it.)
2. **Step, then settle, then re-measure.** Dose a measured amount (≤~0.3–0.5 pH
   worth, ≤50 ml/step), then WAIT ~30+ min for the reservoir to mix and a fresh
   reading to land before the next step. Never stack doses on an unmixed tank.
   (A settle gate enforces the minimum wait.) After a pH dose, set
   \`next_check_minutes\` to ~30–45 so you come back to continue the titration.
3. **Size each step from the OBSERVED response.** Use the recent dosing actions
   + the pH that followed: if X ml moved pH by ΔY, estimate the ml to close the
   REMAINING gap to target — then take ~70–80% of it (a margin against
   overshoot). Converge over a few settle-gated steps; don't guess blindly.
4. **Stop the moment pH enters the target band.** Don't over-titrate toward the
   exact midpoint — inside the band is done.
5. **There is a daily acid ceiling.** If you reach it and pH still won't hold,
   the cause is structural (source-water alkalinity), not insufficient dosing —
   raise a water-change / source-water task instead of asking for more acid.
- A pH reading drifting *inside* its band is normal. Name it, take no action.

# Your purpose: realise the plant's Telos

Keeping numbers in band keeps the plant alive; that is the floor, not the job.
Your purpose is the plant's **Telos** — its fullest potential: the most vigour,
aroma, quality and yield THIS cultivar is capable of. A specific goal in the
Grow Context (a cultivar, a harvest date, a buyer) is a target layered on top;
when it's absent or generic, the purpose still stands — bring the plant to what
no one else reaches. Continuously look for what would make it better — light,
water temperature, water freshness, airflow, root health, harvest timing, the
bed itself — and when you see something worth doing that the doser can't
deliver, propose it as a specific, concrete task (a \`manual_action\` or a
\`question\`). Reactive dosing is survival; proactive optimization is mastery.

**Much of realising a plant's potential happens by hand, beyond this system's
scope.** The rig controls water chemistry; it cannot prune, pinch/top, train,
trellis, defoliate, transplant, scout for pests, or harvest — yet these are
often the highest-leverage moves toward the plant's Telos. Treat them as
first-class: recommend them as \`manual_action\` tasks when they'd advance the
plant (e.g. pinch basil above a node for bushier growth; thin lower leaves
crowding the base; harvest before it bolts). And when the grower reports doing
one, ACCOUNT for it — a heavy prune cuts transpiration, so a following EC or
water-level change may be the pruning, not the plant being hungry. The grower
can always decline or say it isn't possible — then find another path to the
same end.

**Reason from the WHOLE grow, not two numbers.** pH and EC are symptoms; look
for the cause in the full picture — the Grow Context (source-water pH, light
regime, climate), the time of day, the weather, the season. Examples for THIS
POC (a new basil line in full sun all day, high heat, high-pH source water):
- High-pH source water means pH will *keep* climbing after every correction —
  that's structural, not noise. The real answer may be a water change or a
  source-water fix, not endless pH Down. Say so.
- Full sun + heat drives hard transpiration and evaporation → the reservoir
  concentrates (EC rises) and warms (less dissolved oxygen, slowed uptake).
  A midday EC spike from evaporation is not the same as the plant being hungry.
- When the data doesn't add up from pH/EC alone, name the likely external driver
  (heat, light load, source water, root zone) and, if useful, raise a \`question\`
  to confirm or a \`manual_action\` to address the cause. Infer; don't just react.

# Harvest & physical actions — plan ahead, then OPEN A TASK

Physical work on the plant is YOURS to initiate, not the grower's to remember.
Any physical action the plant needs — prune, pinch/top, remove flower buds,
thin, train, transplant, scout — MUST be raised as a \`manual_action\` task with
concrete, cultivar-specific instructions in the payload (what to cut, where, how
much). Never leave it as a sentence in \`analysis\`.

Harvest is cultivar-specific — read the harvest model in Cultivar Knowledge. It
may be **cut_and_come_again** (repeated partial cuts; the plant keeps
producing — basil), **repeated_pick** (pick as it ripens — tomato/pepper), or
**single_terminal** (one final cut ends the grow — head lettuce). Treat harvest
as a PLANNED, optimal event you own:
- Maintain the **Optimal Harvest Plan** via the \`harvest_plan\` field in your
  output: set \`next_date\` (ISO \`YYYY-MM-DD\`) from the cultivar's first-harvest
  trigger + cadence + the current stage, a \`prep_lead_days\` heads-up window
  (e.g. 1), \`instructions\` (exactly what to do at the cut), and a short Hebrew
  \`note\`. Use the Current time block to compute the date.
- About \`prep_lead_days\` before \`next_date\`: OPEN a \`manual_action\` "הכנה לקציר"
  heads-up task (what to ready). When \`next_date\` arrives and the markers are
  met: OPEN the \`manual_action\` harvest task with the execution instructions.
- After a harvest is reported done: ROLL \`next_date\` forward by the cadence
  (cut_and_come_again / repeated_pick), or close the grow (single_terminal).
- Emit \`harvest_plan\` ONLY when creating or changing it; omit it otherwise — the
  stored plan persists between cycles.

# Every cycle is a PROACTIVE REVIEW — not just a band check

When you're invoked and every reading is comfortably in-band, that is NOT a
no-op. It is your standing proactive review, and "all healthy, nothing to do"
should be the EXCEPTION, not your default answer. Being in-band means the floor
is met — now do the job: bring THIS cultivar toward its fullest expression.

On each review, actively walk this checklist and surface the single best next
move (don't dump five):
1. **Cultivar Knowledge** — given the current stage, what does this cultivar
   need NEXT? Read its early stress signals and quality/harvest markers (above).
   Is a stage-appropriate horticultural move due (pinch/top, thin, train, scout,
   begin/holding a harvest window)?
2. **The whole grow** — source water / alkalinity trend, light, heat, airflow,
   water/root-zone temperature, freshness. Is something structural worth fixing
   AHEAD of a drift (e.g. alkalinity slowly pushing pH up; afternoon heat
   approaching the bolt threshold)?
3. **A known risk window approaching** — e.g. a warm-humid night favours basil
   downy mildew; get ahead of it with airflow/spacing guidance, don't wait for
   lesions.

If you find a worthwhile move the doser can't deliver, raise it as a
\`manual_action\` (or a \`question\` if you need info first). If genuinely nothing
is worth acting on, say so briefly — that's allowed, just not the reflex.

CRITICAL: proactive ≠ dose-happy. In-band readings still mean **DO NOT force
corrective dosing** (see the dead-band rule). Proactive optimization is about
environment, canopy, timing, root health and teaching the grower — not chasing
numbers that are already fine.

# Decision Cadence — IMPORTANT

This system has hours-scale inertia, not minutes. A 60-liter reservoir does not
change pH meaningfully in 2 minutes. **You decide on the order of hours, not
minutes.** Sensors sample every ~5 minutes for monitoring; that does NOT mean
each new reading deserves an action.

Default \`next_check_minutes\` guidance:
- **healthy**: the system re-engages you on a stage-aware proactive cadence
  (more often in sensitive stages, less often in stable ones) — you don't need
  to compute it. Suggest 240–480 if asked.
- **attention**: 120–240 minutes (2–4 hours).
- **warning**: 60–120 minutes.
- **critical**: 15–30 minutes.

Slow on DOSING is correct — reacting to every minute-scale fluctuation harms
plants. But slow ≠ passive: between doses you are still actively reviewing and
steering the grow, not waiting to be asked.

# Drift vs Noise — Use the Windowed Statistics

You receive windowed statistics for each metric:
- 5min  median + std (recent state)
- 1h    median + std + linear trend per hour
- 6h    median + std + linear trend per hour
- 24h   median + std + linear trend per hour

Rules:
1. **Real drift requires cross-window agreement.** If 1h trend matches 6h trend
   in direction and magnitude, the drift is real. Sharp disagreement = noise.
2. **A single anomalous reading is not drift.** Readings flagged \`[!]\` are >3σ
   from the 1h median — treat as suspect (sensor glitch, probe bubble).
3. **Direction matters more than magnitude.** Drift toward target = positive,
   leave alone. Drift away from target = negative, act if multiple windows agree.
4. **Stable variance = healthy.** Low std across windows means stable; high std
   means noisy probe — be conservative.
5. **For judgment, weight the 1h median over current reading.** Hard safety
   limits do operate on current readings, but your reasoning should weight stability.

# Dead-band controller (CRITICAL — the user explicitly asked for this)

Each metric has a target + tolerance band that accounts for normal diurnal
drift.  pH naturally swings ±0.2-0.4 across a day in an outdoor NFT
system: photosynthesis raises pH during peak daylight (10:00-16:00),
respiration lowers it overnight, warmer water amplifies both.

**If a current reading is WITHIN its tolerance band, you DO NOT propose
corrective dosing.**  Even if the value isn't exactly at target.  Even
if the 1h trend is non-zero.  The band already absorbs the normal swing.

You ONLY propose correction when:
1. The reading is OUTSIDE the band (status='outside' in the per-cycle prompt), AND
2. Multi-window trends agree the drift is real (1h + 6h same direction), AND
3. The trend is moving AWAY from target, not toward it, AND
4. No earlier action this cycle is still mixing through the reservoir.

For "edge" readings (between 1× and 1.5× the band width): wait for
sustained drift across the next cycle.  Don't be the controller that
chases noise into oscillation.

The per-cycle prompt's "## Tolerance Bands" section shows current status
for each metric.  Trust it.  Don't override "within" with intuition.

# The System You Operate

Wall-mounted NFT (Nutrient Film Technique) hydroponic system in Tel Aviv,
Israel. Vertical pipes with continuous thin-film flow, 60-liter reservoir
with float valve top-up. **Outdoors, exposed to direct sun** — water temperature
swings significantly across the day, especially summer (May–October).

Implications:
- Hot midday water (>28°C) → reduced O2, root stress, slowed uptake.
- Float-valve top-up dilutes constantly → expect EC drift down.
- Peak uptake 10:00–16:00 → dosing right before peak is most impactful.

# Crop Knowledge

**Lettuce**: pH 5.5–6.5 (sweet 5.8–6.0). EC 800–1200 μS/cm. Water 18–24°C; bolts >26°C. pH rises slowly with H+ uptake.
**Basil**: pH 5.5–6.5. EC 1000–1600. Water 18–26°C. Heavy feeder.
**Spinach**: pH 6.0–7.0. EC 1200–1800. Water 16–22°C. Bolts >24°C.
**Strawberry**: pH 5.5–6.2 (narrow). EC 1000–1500 veg, 1300–1800 flowering. Water 18–24°C.
**Tomato**: pH 5.8–6.8. EC 2000–3500. Stage-dependent — 1500 early, 2000–2500 flowering, 3000+ ripening.

Unknown crop → default to lettuce + create a \`question\` task.

# Sensor Trust — suspect the probe before you act

A buffered 60L reservoir has hours-scale inertia. Physics that is IMPOSSIBLE
from biology/dosing means the PROBE is wrong, not the water — and you must NOT
dose into a wrong reading. Suspect the sensor first when you see:
- **pH at a physical extreme** (below ~4.5 or above ~7.8), especially if it sits
  there with near-zero variance — a real reservoir rarely holds such extremes.
- **pH swinging across a wide arc in under a day** (e.g. ~4 → ~8). Plant uptake
  + dosing cannot do that to a buffered reservoir; a drifting/dirty/out-of-
  solution probe can.
- **EC collapsing toward zero** (<~150 μS/cm ≈ plain water/air) with no water
  change reported — the probe is likely out of the solution or fouled.
- **pH and EC moving in physically inconsistent directions.**

When you suspect the probe: do NOT dose. State the suspicion plainly, and raise
a \`manual_action\` task asking the grower to check the probe is submerged, clean,
and calibrated (a fresh calibration with buffer solution). Acting on a bad probe
is how a reservoir gets wrecked. A clean, recently-verified probe earns trust;
an extreme spike from a quiet baseline does not.

# Sensor Notes (PH-W218)

- **pH:** drift up = plant uptake (normal, slow). A *sudden* or *extreme* change = probe first (see above).
- **EC:** drift down = uptake + top-up dilution. Drift up without dosing = evaporation. Near-zero = probe out of solution.
- **ORP:** 200–400 mV healthy. <150 = oxygen-poor. >500 = oxidizer present.
- **TDS:** ~EC × 0.5–0.7, ignore if EC present.
- **Water temp:** the dominant outdoor variable — above 28°C reduces uptake; above 32°C → root-death risk. A hot midday peak that cools by night is the diurnal norm here (don't re-alarm it every cycle); a sustained high is worth a cooling/shade recommendation to the grower.

# Dosing Math (60L reservoir, calibrate to actual reservoir size)

- **Nutrients:** typical liquid concentrate ~2–3 ml raises EC by ~50 μS/cm on a 60L
  reservoir. The exact ml→EC ratio depends on the installed FertilizerProfile —
  the per-cycle prompt lists it under "Installed Fertilizer".
- **pH down (e.g. phosphoric acid):** ~1 ml drops pH ~0.2–0.4. Start with 0.5 ml.
- **pH up (e.g. potassium hydroxide):** similar magnitude in the other direction. Start small.
- **Multi-component lines:** dose components in the per-stage ratio listed under
  "Installed Fertilizer". Never dose a single component on its own unless you
  diagnose a specific deficiency.
- **Single-component lines:** one channel covers all nutrients; the agent
  calibrates ml→EC empirically from the dosing log.

After any dose, set \`next_check_minutes\`: 30–60.

# Available Channels Depend On The Rig

The per-cycle prompt lists "Available Dosing Channels" — that's the ENTIRE
universe of dose actions you can request. Some systems have:
- pH up only (no pH down) → if pH goes too high, raise a **manual_action** task.
- pH down only (no pH up) → if pH drops too low, raise a **manual_action** task.
- Both pH channels → handle drift in either direction autonomously.
- Single-bottle fertilizer (no separate Micro/Grow/Bloom) → one nutrient channel.

Never propose actions on channels not listed for this rig. The SafetyController
will block them anyway, but it's wasted reasoning.

# Safety Hard Limits (do not fight)

pH 4.5–8.0 absolute · EC 100–3500 μS/cm · water 5–35°C · max 50 ml/single dose ·
max 150 ml/hour/channel · min 60s between doses on same channel · sensor max 5 min stale.
pH titration: ONE direction/day (opposite locked ~18h) · ~30 min settle between same-direction
steps · ≤150 ml/day total pH adjuster. Hit the daily pH ceiling and pH still drifts → it's
source-water alkalinity; raise a water-change task, don't ask for more acid.

# Human Task Queue

**A need you identify but do nothing about does not exist to the grower. Every
need MUST leave the cycle as a structured output — a dose \`action\` or a task —
NEVER only as a sentence in your \`analysis\`.** This is the most common failure:
the brain writes "EC dropped, the basil needs feeding" and emits no action and no
task, so nothing reaches the grower. That is a failure of your job.

Rules:
- **Dosing is manual on this system unless told otherwise.** When the plant needs
  an input you can't execute, STILL emit the dose as an \`action\` (exact channel +
  ml) — it becomes a \`dose_approval\` task the grower performs by hand. Recommend
  the CORRECT dose (right-sized), not a timid one; the grower decides.
- If the right move isn't a dose, raise the fitting task below.

Task types:
- **water_change**: nutrient solution exhausted/imbalanced beyond dosing fix. Payload \`{suggested_volume_liters}\`. medium, expires 48h.
- **dose_approval**: a dose the grower should run (manual dosing, or >30% of daily quota, or outside normal envelope). Payload \`{channel, amount_ml, daily_quota_used}\`. high.
- **system_reset**: rate limits blocking action / calibration drift. Payload \`{scope}\`. low, no expiry.
- **question**: clarifying info needed (crop, growth stage, recent additions, probe status). Payload \`{question, context}\`. medium, no expiry.
- **manual_action**: a physical action the grower performs by hand — maintenance (replace/clean/recalibrate the sensor, top up a bottle, check a blockage), an environment optimization the doser can't deliver (shade the reservoir, raise the light, refresh the water), OR a horticultural action on the plant itself (prune, pinch/top, train/trellis, defoliate, transplant, scout for pests, harvest). Payload \`{action, instructions}\`. medium, expires 24h.

**Don't spam, but don't go silent.** Skip only if the same task is already
pending. A persistent real need that was dismissed/expired SHOULD resurface (the
grower may have missed it, or it worsened) — re-raise it with the current
evidence. The grower dismissing a task is feedback you'll see in Recent
Episodes; respect a recent decline, don't blindly repeat within hours of it.

# Language

- \`analysis\`, \`reason\`, \`concerns\`: English.
- \`message_to_grower\`, human task \`title\`/\`reason\`: Hebrew (natural, professional).

# Response Schema (JSON exactly, no markdown wrapping)

The valid \`channel\` values are listed in "Available Dosing Channels" of the
per-cycle prompt. Use those keys exactly.

\`\`\`
{
  "analysis": "1-3 sentences referencing cross-window evidence",
  "status": "healthy" | "attention" | "warning" | "critical",
  "actions": [
    { "channel": "<one of available>", "amount_ml": <number>, "reason": "<English>" }
  ],
  "human_tasks_to_create": [
    { "type": "...", "priority": "low|medium|high|urgent", "title": "<Hebrew>", "reason": "<Hebrew>", "payload": {...}, "expires_in_hours": <number|null> }
  ],
  "next_check_minutes": <int>,
  "message_to_grower": "<Hebrew 1-2 sentences>",
  "concerns": ["<English>", ...],
  "harvest_plan": { "mode": "<cut_and_come_again|repeated_pick|single_terminal>", "next_date": "YYYY-MM-DD|null", "prep_lead_days": <int>, "instructions": "<English>", "note": "<Hebrew>" }
}
\`\`\`

If no action and no task: empty arrays. \`harvest_plan\` is OPTIONAL — include it
only when creating or changing the plan; omit the key otherwise. Always emit the
rest of the structure.`;


// ---------------------------------------------------------------------------
// Window statistics
// ---------------------------------------------------------------------------

const WINDOWS: ReadonlyArray<readonly [string, number]> = [
  ["5min", 5 * 60_000],
  ["1h", 60 * 60_000],
  ["6h", 6 * 60 * 60_000],
  ["24h", 24 * 60 * 60_000],
];

const METRIC_FIELDS = ["ph", "ec", "tds", "orp", "water_temp", "salinity", "cf", "sg"] as const;
type MetricField = (typeof METRIC_FIELDS)[number];

const METRIC_DISPLAY: Record<MetricField, { unit: string; digits: number }> = {
  ph:         { unit: "",       digits: 2 },
  ec:         { unit: "μS/cm",  digits: 0 },
  tds:        { unit: "ppm",    digits: 0 },
  orp:        { unit: "mV",     digits: 0 },
  water_temp: { unit: "°C",     digits: 1 },
  salinity:   { unit: "PPM",    digits: 0 },
  cf:         { unit: "",       digits: 2 },
  sg:         { unit: "",       digits: 3 },
};

function valuesFor(readings: WaterReading[], field: MetricField): number[] {
  const out: number[] = [];
  for (const r of readings) {
    const v = r[field];
    if (v !== null && v !== undefined) out.push(v);
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function pstdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function trendPerHour(readings: WaterReading[], field: MetricField): number | null {
  const points = readings
    .map((r) => [r.ts.getTime(), r[field]] as const)
    .filter(([, v]) => v !== null && v !== undefined) as Array<readonly [number, number]>;
  if (points.length < 3) return null;
  const t0 = points[0][0];
  const xs = points.map(([t]) => (t - t0) / 1000);
  const ys = points.map(([, v]) => v);
  const xMean = mean(xs);
  const yMean = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  if (den === 0) return null;
  const slopePerSec = num / den;
  return slopePerSec * 3600;
}

function filterAge(readings: WaterReading[], maxAgeMs: number, now: Date): WaterReading[] {
  const cutoff = now.getTime() - maxAgeMs;
  return readings.filter((r) => r.ts.getTime() >= cutoff);
}

function isAnomaly(value: number | null, window1h: WaterReading[], field: MetricField): boolean {
  if (value === null) return false;
  const values = valuesFor(window1h, field);
  if (values.length < 5) return false;
  const std = pstdev(values);
  if (std === 0) return false;
  return Math.abs(value - median(values)) > 3 * std;
}

function format(value: number, field: MetricField): string {
  return value.toFixed(METRIC_DISPLAY[field].digits);
}

export function buildMetricTable(
  current: WaterReading,
  recent: WaterReading[],
  now: Date = new Date()
): string {
  const all = [...recent, current].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const lines: string[] = [];

  for (const field of METRIC_FIELDS) {
    const curVal = current[field];
    if (curVal === null && valuesFor(all, field).length === 0) continue;
    const unit = METRIC_DISPLAY[field].unit;
    const unitPart = unit ? ` ${unit}` : "";
    lines.push(`\n${field.toUpperCase()}:`);

    const oneH = filterAge(all, 60 * 60_000, now);

    if (curVal !== null && curVal !== undefined) {
      const flag = isAnomaly(curVal, oneH, field) ? "  [!] suspect — >3σ from 1h median" : "";
      lines.push(`  now:  ${format(curVal, field)}${unitPart}${flag}`);
    } else {
      lines.push(`  now:  (no current reading)`);
    }

    for (const [label, ageMs] of WINDOWS) {
      const win = filterAge(all, ageMs, now);
      const values = valuesFor(win, field);
      if (values.length === 0) {
        lines.push(`  ${label.padEnd(5)} (no data)`);
        continue;
      }
      const m = median(values);
      const s = pstdev(values);
      const t = values.length >= 3 ? trendPerHour(win, field) : null;
      const parts = [
        `median=${format(m, field)}`,
        `σ=${format(s, field)}`,
        `n=${values.length}`,
      ];
      if (t !== null) parts.push(`trend=${t >= 0 ? "+" : ""}${t.toFixed(3)}/h`);
      lines.push(`  ${label.padEnd(5)} ${parts.join(" · ")}`);
    }
  }

  return lines.join("\n").trim();
}

// ---------------------------------------------------------------------------
// USER PROMPT
// ---------------------------------------------------------------------------

export type SystemProfile = {
  system_type?: string;
  reservoir_liters?: number;
  crop_type?: string;
  growth_stage?: string;
  location?: string;
  outdoor?: boolean;
  /** Whether the autonomous loop is allowed to EXECUTE doses (vs only propose). */
  autonomous_dosing_enabled?: boolean;
  /** Whether the doser verification protocol has been completed. */
  doser_verified?: boolean;
  /** Per-channel remaining ml of liquid in each bottle, if declared. */
  bottle_levels?: Record<string, number> | null;
};

/**
 * Render the cultivar's deep, QUALITATIVE knowledge (Network Knowledge layer)
 * into a prompt section: the early stress signals to catch before they hit
 * pH/EC, the quality/harvest markers to steer toward, and the cultivar's
 * essence. The numeric stage bands are rendered separately (tolerance bands,
 * already cultivar+stage resolved). This knowledge previously sat unused in the
 * registry — it's the difference between a generic band-keeper and an expert in
 * THIS plant, and it's the menu the Brain optimizes toward on an in-band review.
 */
function renderCultivarKnowledge(
  cultivar: CultivarRecord | null | undefined,
  stage: string | null
): string | null {
  if (!cultivar) return null;
  const name = cultivar.cultivar || cultivar.species;
  const lines: string[] = [
    `## Cultivar Knowledge — ${name}${cultivar.provenance ? ` · ${cultivar.provenance}` : ""} · stage: ${stage ?? "vegetative"}`,
    "What an expert grower of THIS cultivar knows. Use it in EVERY decision — it OVERRIDES generic crop defaults. When readings are in-band, THIS is what you proactively steer toward; don't just confirm 'healthy'.",
  ];
  const story = cultivar.story?.en?.trim();
  if (story) lines.push(`  Essence: ${story}`);
  if (cultivar.stress_signatures?.length) {
    lines.push("  Early stress signals — catch these BEFORE pH/EC drift (the cue to act proactively):");
    for (const s of cultivar.stress_signatures) lines.push(`    - ${s}`);
  }
  if (cultivar.harvest_markers?.length) {
    lines.push("  Quality / harvest markers — steer toward these and time the harvest by them:");
    for (const h of cultivar.harvest_markers) lines.push(`    - ${h}`);
  }
  const harvest = resolveCultivarHarvest(cultivar.id);
  if (harvest) {
    const cadence =
      harvest.mode === "single_terminal"
        ? "one final harvest ends the grow"
        : harvest.cadence_days
        ? `recurring ≈ every ${harvest.cadence_days} days`
        : "recurring";
    lines.push(`  Harvest model: ${harvest.mode} (${cadence}).`);
    lines.push(`    First harvest: ${harvest.first_harvest}`);
    lines.push(`    How: ${harvest.instructions}`);
    if (harvest.end_of_grow) lines.push(`    End of grow: ${harvest.end_of_grow}`);
  }
  return lines.join("\n");
}

export function buildUserPrompt(opts: {
  current: WaterReading;
  recent: WaterReading[];
  systemProfile: SystemProfile;
  recentActions: Array<{ ts: Date; channel: string; amount_ml: number; success: boolean; reason: string }>;
  availableChannels: string[];
  /** Per-system dosing config — drives the channel/profile context lines. */
  dosingConfig?: DosingConfig;
  /** Profile referenced by the config; used to render NPK + stage ratios. */
  fertilizerProfile?: FertilizerProfile | null;
  /** Per-channel feed-tube priming state — first ~8ml on unprimed channels doesn't reach reservoir. */
  primingState?: PrimingState | null;
  /** Per-channel bottle status report (capacity, remaining, % left, days-until-empty). */
  bottleReport?: {
    channels: ChannelBottleStatus[];
    any_near_empty: boolean;
    any_needs_recheck: boolean;
  } | null;
  /** Per-system tolerance bands for pH/EC/water-temp (the dead-band controller's setpoints). */
  targets?: TargetRanges;
  /** Diurnal context — period + expected pH drift for the current time of day. */
  diurnal?: { period: string; expected_ph_drift: string };
  /** The personal Brain of this grow (Grow Context layer) — onboarding answers. */
  growProfile?: GrowProfile | null;
  /** Grower Memory — facts/corrections/preferences the grower has taught the Brain. */
  growerMemory?: GrowerMemoryEntry[] | null;
  /** Episodic memory — the Brain's own recent-cycle narrative log. */
  episodes?: GrowEpisode[] | null;
  /** Cultivar record (Network Knowledge) — the deep, cultivar-specific knowledge the Brain acts from. */
  cultivar?: CultivarRecord | null;
  pendingTasks: Pick<HumanTask, "id" | "type" | "priority" | "title" | "created_at">[];
}): string {
  const {
    current,
    recent,
    systemProfile,
    recentActions,
    availableChannels,
    dosingConfig,
    fertilizerProfile,
    primingState,
    bottleReport,
    targets,
    diurnal,
    growProfile,
    growerMemory,
    episodes,
    cultivar,
    pendingTasks,
  } = opts;
  const sections: string[] = [];
  const now = new Date();

  sections.push("## Sensor Statistics (windowed — use these, not raw points)");
  sections.push(`Current reading timestamp: ${current.ts.toISOString()} (${relAge(current.ts, now)})`);
  sections.push(`Source: ${current.source}`);
  sections.push("");
  sections.push(buildMetricTable(current, recent));
  sections.push("");

  sections.push("## System Instance");
  sections.push(`  Type: ${systemProfile.system_type ?? "nft_wall_mounted"}`);
  sections.push(`  Reservoir: ${systemProfile.reservoir_liters ?? 60} liters`);
  sections.push(`  Crop: ${systemProfile.crop_type ?? "lettuce"}`);
  sections.push(`  Growth stage: ${systemProfile.growth_stage ?? "vegetative"}`);
  sections.push(`  Location: ${systemProfile.location ?? "Tel Aviv, Israel"}`);
  sections.push(`  Outdoor: ${systemProfile.outdoor ?? true}`);
  sections.push("");

  // Cultivar Knowledge — the deep, cultivar-specific knowledge (Network Knowledge
  // layer). This is what makes the Brain an EXPERT in THIS plant rather than a
  // generic band-keeper. It must inform every decision, and on an in-band
  // proactive review it's the menu of what to optimize toward.
  const cultivarSection = renderCultivarKnowledge(cultivar, systemProfile.growth_stage ?? null);
  if (cultivarSection) {
    sections.push(cultivarSection);
    sections.push("");
  }

  // Optimal Harvest Plan — the planned-ahead target the Brain maintains. Shown
  // so the Brain can roll it forward, and act on it (prep + execution tasks).
  const hp = growProfile?.harvest_plan;
  if (hp) {
    sections.push("## Optimal Harvest Plan (you maintain this)");
    sections.push(`  Mode: ${hp.mode} · Next harvest: ${hp.next_date ?? "not set"} · prep heads-up ${hp.prep_lead_days}d before`);
    sections.push(`  Instructions: ${hp.instructions}`);
    if (hp.note) sections.push(`  Note: ${hp.note}`);
    sections.push("");
  }

  // Grow Context — the personal Brain of this grow (onboarding answers + what's
  // still unknown so the brain asks rather than guesses).
  sections.push(renderGrowContext(growProfile));
  sections.push("");

  // Grower Memory — what the grower has taught the Brain (omitted when empty).
  const memorySection = renderGrowerMemory(growerMemory);
  if (memorySection) {
    sections.push(memorySection);
    sections.push("");
  }

  // Episodic memory — the Brain's own recent-cycle log (omitted when empty).
  const episodeSection = renderEpisodes(episodes);
  if (episodeSection) {
    sections.push(episodeSection);
    sections.push("");
  }

  // CRITICAL safety context — the brain must know whether its proposals
  // will execute or queue, and which bottles can actually deliver liquid.
  sections.push("## Execution Authority + Bottle Inventory");
  const autonomous = systemProfile.autonomous_dosing_enabled === true;
  const verified = systemProfile.doser_verified === true;
  sections.push(`  Autonomous dosing: ${autonomous ? "ENABLED" : "DISABLED"} ${autonomous ? "" : "← proposals will be queued as Human Tasks, NOT executed by this cycle"}`);
  sections.push(`  Doser verified: ${verified ? "yes" : "no"} ${verified ? "" : "← grower hasn't run runDoserProtocol yet; daily-total cap is tight (30ml)"}`);
  if (bottleReport && bottleReport.channels.length > 0) {
    sections.push("  Bottle status (capacity / remaining / consumption / forecast):");
    for (const c of bottleReport.channels) {
      const parts: string[] = [];
      parts.push(
        c.remaining_ml !== null
          ? `${c.remaining_ml.toFixed(1)}ml remaining`
          : "remaining=unknown"
      );
      if (c.capacity_ml !== null) {
        parts.push(`of ${c.capacity_ml.toFixed(0)}ml capacity`);
      }
      if (c.percent_remaining !== null) {
        parts.push(`(${c.percent_remaining.toFixed(0)}%)`);
      }
      if (c.daily_avg_ml !== null) {
        parts.push(`avg ${c.daily_avg_ml.toFixed(1)}ml/day`);
      }
      if (c.days_until_empty !== null) {
        parts.push(`~${c.days_until_empty.toFixed(1)} days until empty`);
      }
      const flagTag =
        c.level === "empty"
          ? " ⚠ EMPTY — cannot dose"
          : c.level === "near_empty"
          ? " ⚠ NEAR-EMPTY (<15ml floor) — safety will block"
          : c.level === "low"
          ? " ⚠ LOW (<25%) — recommend refill"
          : "";
      const recheckTag = c.needs_recheck && c.remaining_ml !== null
        ? " · 🔎 visual recheck overdue"
        : "";
      sections.push(`    - ${c.channel}: ${parts.join(" · ")}${flagTag}${recheckTag}`);
    }
    if (bottleReport.any_near_empty) {
      sections.push(
        "    ⚠ At least one channel is near-empty.  Either create a manual_action human task asking the grower to refill, or hold off proposing doses on that channel."
      );
    }
    if (bottleReport.any_needs_recheck) {
      sections.push(
        "    🔎 Some channels haven't been visually verified in 7+ days.  When you next chat with the grower, suggest a 'verify bottle levels' check."
      );
    }
  } else if (systemProfile.bottle_levels) {
    // Fallback to the basic levels-only block when no report computed.
    sections.push("  Bottle levels (ml remaining, no capacity/forecast):");
    for (const [k, v] of Object.entries(systemProfile.bottle_levels)) {
      const tag = v < 15 ? " ⚠ NEAR-EMPTY, cannot dose" : v < 30 ? " ⚠ low" : "";
      sections.push(`    - ${k}: ${v.toFixed(1)}ml${tag}`);
    }
  } else {
    sections.push("  Bottle levels: NOT DECLARED — grower hasn't told us how much liquid is in each bottle.");
    sections.push("    Don't reason about 'we have enough nutrient' or 'pH Down is running low' — you literally have no inventory data.");
  }
  if (!autonomous) {
    sections.push(
      "  REASONING IMPLICATION: dosing is MANUAL here — any dose you propose becomes a dose_approval task the grower runs by hand. So if the plant needs an input, you MUST still propose it (the right-sized, correct dose — not a timid one): a need you don't turn into a task never reaches the grower. The grower reviews each one, so be precise and explain it; don't assume an immediate retry."
    );
  }
  sections.push("");

  if (recentActions.length > 0) {
    sections.push("## Recent Dosing Actions (last 24h)");
    for (const a of recentActions.slice(-10)) {
      sections.push(
        `  [${a.ts.toISOString()}] (${relAge(a.ts, now)}) ${a.channel}: ${a.amount_ml}ml (${a.success ? "OK" : "FAILED"}) — ${a.reason}`
      );
    }
    sections.push("");
  } else {
    sections.push("## Recent Dosing Actions");
    sections.push("  (none in the last 24h)");
    sections.push("");
  }

  if (pendingTasks.length > 0) {
    sections.push("## Currently Pending Human Tasks (do not duplicate these types)");
    for (const t of pendingTasks) {
      sections.push(
        `  #${t.id} [${t.priority}] ${t.type}: ${t.title} (created ${t.created_at.toISOString().slice(0, 16)}, ${relAge(t.created_at, now)})`
      );
    }
    sections.push("");
  } else {
    sections.push("## Currently Pending Human Tasks");
    sections.push("  (none)");
    sections.push("");
  }

  sections.push("## Installed Fertilizer");
  if (fertilizerProfile) {
    sections.push(`  Profile: ${fertilizerProfile.name_en} (${fertilizerProfile.vendor})`);
    sections.push(`  Profile ID: ${fertilizerProfile.id}`);
    if (fertilizerProfile.ml_per_50us_per_60L !== undefined) {
      sections.push(
        `  Rough calibration: ${fertilizerProfile.ml_per_50us_per_60L} ml of mixed-nutrient ≈ +50 μS/cm on 60L`
      );
    }
    sections.push("  Components:");
    for (const c of fertilizerProfile.components) {
      const parts = [`    - ${c.key} (${c.label_en})`];
      if (c.npk) parts.push(`NPK=${c.npk}`);
      sections.push(parts.join(" · "));
    }
    const stage = (systemProfile.growth_stage as string | undefined) ?? "vegetative";
    const stageRatio = fertilizerProfile.stage_ratios[stage];
    if (stageRatio) {
      const ratioStr = Object.entries(stageRatio)
        .map(([k, v]) => `${k}=${v}`)
        .join(" : ");
      sections.push(`  Stage ratio (${stage}): ${ratioStr}`);
    }
  } else {
    sections.push("  (no profile attached — assume single-bottle generic nutrient)");
  }
  sections.push("");

  sections.push("## Available Dosing Channels (the ENTIRE universe of dose actions)");
  if (dosingConfig) {
    for (const c of availableChannels) {
      const a = dosingConfig.assignments[c];
      const phys = a ? `physical channe${a.physical}` : "?";
      const role = a?.role ?? "?";
      const primed = primingState?.channels[c]?.primed;
      const primingTag =
        primed === undefined
          ? ""
          : primed
          ? " · primed"
          : " · UNPRIMED (first ~8ml feeds the dead-volume tube, no reservoir change)";
      sections.push(`  - ${c} · role=${role} · ${phys}${primingTag}`);
    }
    const ph = {
      up: hasPhUp(dosingConfig) ? phUpKey(dosingConfig) : null,
      down: hasPhDown(dosingConfig) ? phDownKey(dosingConfig) : null,
    };
    sections.push(
      `  pH correction available: up=${ph.up ?? "no"} · down=${ph.down ?? "no"}`
    );
    const nutrients = nutrientKeys(dosingConfig);
    sections.push(
      `  Nutrient channels: ${nutrients.length > 0 ? nutrients.join(", ") : "(none)"}`
    );
    if (primingState) {
      const unprimed = availableChannels.filter((c) => primingState.channels[c]?.primed === false);
      if (unprimed.length > 0) {
        sections.push(
          `  ⚠ UNPRIMED channels (first ~8ml fills dead-volume, no EC/pH effect): ${unprimed.join(", ")}. ` +
            `If you need to dose one of these, expect the FIRST dose to do nothing measurable.`
        );
      }
    }
  } else {
    for (const c of availableChannels) sections.push(`  - ${c}`);
  }
  sections.push("");

  const hour = now.getHours();
  let period: string;
  if (hour >= 6 && hour < 10) period = "Early morning — plants starting photosynthesis";
  else if (hour >= 10 && hour < 16) period = "Peak daylight — highest uptake; outdoor TLV gets hot";
  else if (hour >= 16 && hour < 20) period = "Late afternoon — uptake winding down";
  else period = "Night — minimal uptake; safe maintenance window";
  sections.push("## Time Context");
  sections.push(`  Now: ${now.toISOString().slice(0, 16)}`);
  sections.push(`  Period: ${period}`);
  if (diurnal) {
    sections.push(`  Diurnal phase: ${diurnal.period}`);
    sections.push(`  Expected pH drift this hour: ${diurnal.expected_ph_drift}`);
  }
  sections.push("");

  // ----- Tolerance bands (the DEAD-BAND CONTROLLER) -----
  if (targets) {
    sections.push("## Tolerance Bands — dead-band controller (READ CAREFULLY)");
    sections.push(
      "  Each metric has a tolerance band around its target.  Inside the band = comfortable, NO ACTION needed even if not exactly at target.  Outside the band = candidate for correction, but only when SUSTAINED across windows (single anomalous readings → ignore)."
    );
    const renderMetric = (
      label: string,
      value: number | null,
      m: { target: number; tolerance: number; tolerance_mode: "absolute" | "percent" } | undefined
    ) => {
      if (!m) return;
      const ev = evaluateMetric(value, m);
      const w = bandWidth(m);
      const statusTag =
        ev.status === "within"
          ? "✓ WITHIN band — DO NOT propose corrective dosing"
          : ev.status === "edge"
          ? "⚠ AT BAND EDGE — act only on sustained drift, not a single reading"
          : ev.status === "outside"
          ? "🔴 OUTSIDE band — consider correction if multi-window agreement confirms drift"
          : "(no current reading)";
      sections.push(
        `  - ${label}: target ${m.target}${m.tolerance_mode === "percent" ? "" : ""} ± ${w.toFixed(2)} (band [${ev.band_low.toFixed(2)}, ${ev.band_high.toFixed(2)}])${value !== null ? ` · now ${value.toFixed(2)}` : ""} → ${statusTag}`
      );
    };
    renderMetric("pH", current.ph, targets.ph);
    renderMetric("EC", current.ec, targets.ec);
    renderMetric("water_temp", current.water_temp, targets.water_temp);
    sections.push(
      "  KEY RULE: if a metric is `within` its band, DO NOT propose a correction — even if 'a bit off target'.  The band already accounts for normal diurnal drift (pH ±0.4 covers typical photosynthesis swing).  Chasing every wobble is how reservoirs get over-corrected."
    );
    sections.push("");
  }

  sections.push("## Your task");
  sections.push(
    "Analyze the cross-window evidence and respond with the JSON schema. " +
      "Act only when multiple windows agree on real drift; ignore [!] points. " +
      "Decisions are hourly-scale."
  );

  return sections.join("\n");
}
