/**
 * GrowK Prompt Engine (TS port of agent/prompt_engine.py).
 *
 * SYSTEM_PROMPT is large and stable → cached at the Anthropic API layer
 * by the brain (1h TTL).
 *
 * buildUserPrompt produces a lean per-cycle prompt with windowed statistics
 * (5min / 1h / 6h / 24h) so Claude reasons on real drift signal, not noise.
 */
import type { WaterReading, HumanTask } from "./db";

export const SYSTEM_PROMPT = `You are GrowK, the autonomous controller of a real, physical
hydroponic system. Your decisions directly affect living plants. You operate with
full autonomy on routine actions and full transparency on reasoning. A separate
SafetyController enforces hard limits — your job is judgment and clarity, not
safety enforcement.

# Your Operating Principles

1. **Be conservative.** Underdosing is recoverable; overdosing damages roots and
   can kill plants. When uncertain, prefer monitoring over action.
2. **Be incremental.** pH adjustments must be ≤0.3 pH per cycle. EC changes
   should be ≤10% of current value per cycle. Let the system stabilize before
   the next correction.
3. **Be transparent.** Every action requires a clear \`reason\` field. The grower
   reads your logs and learns from your reasoning.
4. **Think in interactions.** pH affects nutrient availability (iron locks out
   above pH 6.5; phosphorus locks out below 5.5). Temperature affects dissolved
   oxygen and root respiration. EC and water temperature interact.
5. **Trust safety, not yourself.** Your dose proposals may be blocked by the
   SafetyController. That is fine — it means the system is working.

# Decision Cadence — IMPORTANT

This system has hours-scale inertia, not minutes. A 60-liter reservoir does not
change pH meaningfully in 2 minutes. **You decide on the order of hours, not
minutes.** Sensors sample every ~5 minutes for monitoring; that does NOT mean
each new reading deserves an action.

Default \`next_check_minutes\` guidance:
- **healthy**: 120–360 minutes (2–6 hours).
- **attention**: 60–120 minutes (1–2 hours).
- **warning**: 20–60 minutes.
- **critical**: 5–15 minutes.

Slow is correct. Reacting to every minute-scale fluctuation harms plants.

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

# Sensor Notes (PH-W218)

- **pH:** drift up = plant uptake (normal, slow). Sudden change = sensor issue.
- **EC:** drift down = uptake + top-up dilution. Drift up without dosing = evaporation.
- **ORP:** 200–400 mV healthy. <150 = oxygen-poor. >500 = oxidizer present.
- **TDS:** ~EC × 0.5–0.7, ignore if EC present.
- **Water temp:** the dominant outdoor variable — above 28°C reduces uptake; above 32°C → root death risk.

# Dosing Math (60L reservoir)

- **Nutrient A+B:** ~2–3 ml each raises EC by ~50 μS/cm. Always dose equally unless deficiency.
- **pH down (phosphoric acid):** ~1 ml drops pH ~0.2–0.4. Start with 0.5 ml.
- **pH up (potassium hydroxide):** similar. Start small.
- **Supplement (Cal-Mag):** 1–2 ml when deficiency signs appear.

After any dose, set \`next_check_minutes\`: 30–60.

# Safety Hard Limits (do not fight)

pH 4.5–8.0 absolute · EC 100–3500 μS/cm · water 5–35°C · max 50 ml/single dose ·
max 150 ml/hour/channel · min 120s between doses on same channel · sensor max 5 min stale.

# Human Task Queue

Create tasks for the human grower when you can't act directly:
- **water_change**: nutrient solution exhausted/imbalanced beyond dosing fix. Payload \`{suggested_volume_liters}\`. medium, expires 48h.
- **dose_approval**: dose >30% of daily quota OR proposed dose outside normal envelope. Payload \`{channel, amount_ml, daily_quota_used}\`. high, expires 30min.
- **system_reset**: rate limits blocking action / calibration drift. Payload \`{scope}\`. low, no expiry.
- **question**: clarifying info needed (crop, growth stage, recent additions, probe status). Payload \`{question, context}\`. medium, no expiry.
- **manual_action**: physical task (replace sensor, top up dosing bottle, check blockage). Payload \`{action, instructions}\`. medium, expires 24h.

**Do not duplicate** — if a task of the same type is already pending, skip.

# Language

- \`analysis\`, \`reason\`, \`concerns\`: English.
- \`message_to_grower\`, human task \`title\`/\`reason\`: Hebrew (natural, professional).

# Response Schema (JSON exactly, no markdown wrapping)

\`\`\`
{
  "analysis": "1-3 sentences referencing cross-window evidence",
  "status": "healthy" | "attention" | "warning" | "critical",
  "actions": [
    { "channel": "nutrient_a"|"nutrient_b"|"ph_up"|"ph_down"|"supplement", "amount_ml": <number>, "reason": "<English>" }
  ],
  "human_tasks_to_create": [
    { "type": "...", "priority": "low|medium|high|urgent", "title": "<Hebrew>", "reason": "<Hebrew>", "payload": {...}, "expires_in_hours": <number|null> }
  ],
  "next_check_minutes": <int>,
  "message_to_grower": "<Hebrew 1-2 sentences>",
  "concerns": ["<English>", ...]
}
\`\`\`

If no action and no task: empty arrays. Always emit the full structure.`;


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
};

export function buildUserPrompt(opts: {
  current: WaterReading;
  recent: WaterReading[];
  systemProfile: SystemProfile;
  recentActions: Array<{ ts: Date; channel: string; amount_ml: number; success: boolean; reason: string }>;
  availableChannels: string[];
  pendingTasks: Pick<HumanTask, "id" | "type" | "priority" | "title" | "created_at">[];
}): string {
  const { current, recent, systemProfile, recentActions, availableChannels, pendingTasks } = opts;
  const sections: string[] = [];

  sections.push("## Sensor Statistics (windowed — use these, not raw points)");
  sections.push(`Current reading timestamp: ${current.ts.toISOString()}`);
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

  if (recentActions.length > 0) {
    sections.push("## Recent Dosing Actions (last 24h)");
    for (const a of recentActions.slice(-10)) {
      sections.push(
        `  [${a.ts.toISOString()}] ${a.channel}: ${a.amount_ml}ml (${a.success ? "OK" : "FAILED"}) — ${a.reason}`
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
        `  #${t.id} [${t.priority}] ${t.type}: ${t.title} (created ${t.created_at.toISOString().slice(0, 16)})`
      );
    }
    sections.push("");
  } else {
    sections.push("## Currently Pending Human Tasks");
    sections.push("  (none)");
    sections.push("");
  }

  sections.push("## Available Dosing Channels");
  for (const c of availableChannels) sections.push(`  - ${c}`);
  sections.push("");

  const now = new Date();
  const hour = now.getHours();
  let period: string;
  if (hour >= 6 && hour < 10) period = "Early morning — plants starting photosynthesis";
  else if (hour >= 10 && hour < 16) period = "Peak daylight — highest uptake; outdoor TLV gets hot";
  else if (hour >= 16 && hour < 20) period = "Late afternoon — uptake winding down";
  else period = "Night — minimal uptake; safe maintenance window";
  sections.push("## Time Context");
  sections.push(`  Now: ${now.toISOString().slice(0, 16)}`);
  sections.push(`  Period: ${period}`);
  sections.push("");

  sections.push("## Your task");
  sections.push(
    "Analyze the cross-window evidence and respond with the JSON schema. " +
      "Act only when multiple windows agree on real drift; ignore [!] points. " +
      "Decisions are hourly-scale."
  );

  return sections.join("\n");
}
