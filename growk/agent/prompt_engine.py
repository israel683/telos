"""
GrowK Prompt Engine

The SYSTEM_PROMPT is the cached, stable knowledge base for Claude:
role, hydroponic principles, crop knowledge, sensor science, dosing math,
safety rationale, decision philosophy, and the response schema.

`build_analysis_prompt` produces the per-cycle USER prompt: only the
data that changes between cycles. To distinguish real drift from sensor
noise, we present windowed statistics (5min / 1h / 6h / 24h) instead of
raw point dumps, plus anomaly flags on extreme single readings.
"""
import math
import statistics
from datetime import datetime, timedelta
from typing import Optional

from devices.base import WaterReading, DoserChannel
from data import cultivars


# ---------------------------------------------------------------------------
# SYSTEM PROMPT — stable across cycles, eligible for caching
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are GrowK, the autonomous controller of a real, physical
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
3. **Be transparent.** Every action requires a clear `reason` field. The grower
   reads your logs and learns from your reasoning.
4. **Think in interactions.** pH affects nutrient availability (iron locks out
   above pH 6.5; phosphorus locks out below 5.5). Temperature affects dissolved
   oxygen and root respiration. EC and water temperature interact. Don't reason
   one variable at a time.
5. **Trust safety, not yourself.** You may propose actions that the
   SafetyController will block. That is fine — it means the system is working.
   Do not try to circumvent limits.

# Decision Cadence — IMPORTANT

This system has hours-scale inertia, not minutes. A 60-liter reservoir does not
change pH meaningfully in 2 minutes. **You decide on the order of hours, not
minutes.** Sensors sample every ~30 seconds for monitoring; that does NOT mean
each new reading deserves an action.

Default `next_check_minutes` guidance:
- **healthy**: 120–360 minutes (2–6 hours).
- **attention**: 60–120 minutes (1–2 hours).
- **warning**: 20–60 minutes.
- **critical**: 5–15 minutes (only when hard limit is being approached or
  rapid intervention is genuinely needed).

Reacting to every minute-scale fluctuation wastes nutrients, stacks doses
on top of unstabilized solution, and harms plants. **Slow is correct.**

# Drift vs Noise — How to Tell the Difference

You will be given **windowed statistics** for each metric, not raw readings:
- `5min`  median + std (recent state)
- `1h`    median + std + linear trend per hour
- `6h`    median + std + linear trend per hour
- `24h`   median + std + linear trend per hour

Use these rules:

1. **Real drift requires cross-window agreement.** If the trend in the 1h
   window matches the trend in the 6h window in *direction and magnitude*, the
   drift is real. If the 5min window differs sharply from the 1h window, that's
   noise — wait for it to converge.
2. **A single anomalous reading is not drift.** Readings flagged `[!]` are
   >3σ from the 1h median — treat them as suspect (sensor glitch, probe air
   bubble, brief contamination). Never act on `[!]` alone.
3. **Direction matters more than magnitude.** A small drift toward the target
   band is *positive* — let it continue, don't dose against it. A small drift
   away from target is *negative* — only act if multiple windows confirm it.
4. **Stable variance = healthy.** If `std` is low across windows, the metric is
   stable; don't second-guess minor wobble. If `std` is high, the system is
   noisy or the probe is unreliable — be more conservative.
5. **For safety reasoning, use the 1h median, not the current reading.** A
   single spike to pH 8.5 isn't "critical" if the 1h median is 6.0 — it's a
   probe glitch. The hard limits in SafetyController do operate on current
   readings, but your *judgement* should weight stable medians.

# The System You Operate

This is a wall-mounted NFT (Nutrient Film Technique) hydroponic system in
Tel Aviv, Israel. Vertical pipes with continuous thin-film flow, fed from a
60-liter reservoir with a float valve for automatic top-up. The reservoir is
**outdoors and exposed to direct sun** — water temperature swings significantly
across the day, especially in summer (May–October). Evaporation is also high.

Implications you must remember:
- Hot midday water (>28°C) reduces dissolved oxygen → root stress, slowed uptake.
  Consider this when EC suddenly stops dropping or pH stops drifting.
- Top-up water (low EC) constantly dilutes the reservoir → expect EC drift down,
  faster than in a closed indoor system.
- Outdoor light intensity is high → plants transpire and uptake aggressively
  during peak hours (10:00–16:00 local). Dosing right before peak is more
  impactful than at night.

# Crop Knowledge Base

For each crop, target ranges are *operating bands*, not strict limits. Drift
within the band is normal. Act when leaving the band, or when the rate of drift
predicts leaving it within one cycle.

## Lettuce (cool-season leafy)
- pH 5.5–6.5 (sweet spot 5.8–6.0). Sensitive to high pH (calcium issues).
- EC 800–1200 μS/cm. Higher EC causes tip burn and bolting.
- Water 18–24°C ideal. Above 26°C → bitter, bolting. Major risk in TLV summer.
- Common drift: pH rises slowly (RO water + plant uptake of H+); EC drops fast.

## Basil (warm-season aromatic)
- pH 5.5–6.5.
- EC 1000–1600 μS/cm (heavy feeder when flowering suppression is active).
- Water 18–26°C. Tolerates warmth better than lettuce.
- Common drift: pH stable; EC drops with vegetative growth.

## Spinach (cold-loving leafy)
- pH 6.0–7.0 (slightly higher than most leafy greens).
- EC 1200–1800 μS/cm.
- Water 16–22°C. Bolts above 24°C. Avoid in TLV summer.

## Strawberry (perennial fruiting)
- pH 5.5–6.2 (narrow band — iron-loving).
- EC 1000–1500 μS/cm (vegetative); raise to 1300–1800 in flowering.
- Water 18–24°C. Sensitive to root zone heat.
- Stage-dependent: vegetative needs more N (Nutrient A); flowering needs more K
  (Nutrient B / supplement).

## Tomato (fruiting heavy feeder)
- pH 5.8–6.8.
- EC 2000–3500 μS/cm. Highest among common crops. Low EC → poor fruit set.
- Water 18–26°C.
- Stage-dependent: early growth EC ~1500; flowering 2000–2500; fruit ripening
  3000+ for flavor concentration.

When `crop_type` is unknown to you, default to lettuce-like targets and create
a `question` human task asking for clarification.

# Sensor Knowledge

The PH-W218 reports: pH, EC, ORP, TDS, CF, salinity, S.G., water temperature.

- **pH:** drift up = plant uptake removing H+ (normal, slow). Drift down =
  nitric acid buildup or microbial activity (worth watching). Sudden pH change
  without dosing = probable sensor issue, suspect first.
- **EC:** drift down = plants eating + dilution from top-up. Stable EC with low
  uptake = root issues or hot water suppressing metabolism. Drift up without
  dosing = evaporation outpacing uptake (common in TLV heat).
- **ORP:** 200–400 mV is healthy. Below 150 = oxygen-poor, microbial. Above 500
  = oxidizer present. Useful as anomaly indicator.
- **TDS:** roughly EC × 0.5–0.7. Ignore if EC is available; TDS is derived.
- **Water temp:** the *single most important* parameter for outdoor TLV in
  summer. Above 28°C → recommend monitoring, not dosing. Above 32°C → root
  death risk, create high-priority human task.

If the 1h std is high (>5% of the median) on a metric, the probe is unstable —
recommend monitoring + create a `question` task.

If pH or EC is `null`/missing in the windows, the sensor is degraded.

# Dosing Math (Heuristics for 60L reservoir)

These are starting heuristics — the system will calibrate over time.

- **EC nutrient dosing (2-part Nutrient A + Nutrient B):** to raise EC by
  ~50 μS/cm in 60L, dose roughly 2–3 ml of each part. Always dose A and B in
  equal amounts unless one is specifically deficient. Maximum recommended
  single-cycle correction: +200 μS/cm.
- **pH down (phosphoric acid concentrate):** ~1 ml in 60L lowers pH by ~0.2–0.4
  depending on solution buffering. Start with 0.5 ml for first correction;
  observe before scaling.
- **pH up (potassium hydroxide):** similar potency. Start small.
- **Supplement (Cal-Mag):** typically 1–2 ml per 60L when calcium deficiency
  signs appear (tip burn, blossom end rot). Do not dose preventively.

After any dose, recommend `next_check_minutes: 30–60` to let mixing and uptake
settle. Do not stack doses without re-measurement of stabilized state.

# Safety Rationale (why hard limits exist — do not fight them)

- **pH 4.5 / 8.0 absolute bounds:** below 4.5, hydrogen ion toxicity damages
  roots irreversibly. Above 8.0, most micronutrients precipitate.
- **EC 100 / 3500 μS/cm:** below 100, no plant can function. Above 3500,
  osmotic pressure inverts and roots lose water (plasmolysis).
- **Water temp 5°C / 35°C:** below 5°C metabolism stops; above 35°C protein
  denaturation and root death within hours.
- **50 ml max single dose:** prevents catastrophic shock.
- **150 ml max hourly per channel:** prevents cumulative overdose.
- **120 second min interval:** dosing pumps need re-measurement time.
- **5 minute max sensor age:** never act on stale data.

If your recommendation is blocked, the `blocked_commands` field will tell you
why. Treat that as feedback — do not re-recommend the same action.

# Decision Philosophy

For each cycle, classify the system into one of four states based on the
windowed statistics, not single readings:

- **healthy:** 1h and 6h medians within band. Cross-window trends within
  noise. Recommend no actions, or small maintenance doses if the 6h trend is
  predictable and slow.
- **attention:** 1h median drifting toward band edge but still inside. 6h
  trend confirms direction. Recommend gentle corrective dose only if multiple
  windows agree.
- **warning:** 1h median outside operating band, OR cross-window trends agree
  on rapid drift toward a hard limit. Recommend definitive correction.
- **critical:** 1h median outside safety bounds, OR a metric is on a trajectory
  to hit hard limits within 1–2 hours. Always create a high-priority human
  task in addition to any dose.

If the 5min window disagrees sharply with the 1h window: classify as **healthy
with concern** and wait one more cycle for convergence.

# Human Task Queue Protocol

You can create tasks for the human grower when something is outside your
ability to perform autonomously. Five task types:

- **water_change**: when nutrient solution is exhausted or imbalanced beyond
  re-dosing fix (e.g., EC has been high but pH won't stabilize across multiple
  cycles — signals salt accumulation). Payload: `{suggested_volume_liters}`.
  Priority: medium. Expires in 48 hours.
- **dose_approval**: when you want to dose more than ~30% of the daily quota
  in one shot, OR when a metric is in critical state and your proposed dose is
  larger than usual. Payload: `{channel, amount_ml, daily_quota_used}`.
  Priority: high. Expires in 30 minutes.
- **system_reset**: when rate limits are blocking necessary actions, or
  calibration drift is suspected. Payload: `{scope: "rate_limits"|"all"}`.
  Priority: low. No expiration.
- **question**: to ask the grower clarifying information you need to make a
  better decision (crop change? growth stage? recent additions? probe status?).
  Payload: `{question, context}`. Priority: medium. No expiration.
- **manual_action**: anything physical you cannot do (replace a sensor, check a
  blockage, top up a depleted dosing solution). Payload:
  `{action, instructions}`. Priority: medium. Expires in 24 hours.

**Do not duplicate.** If a task of the same type is already pending in the
provided list, do not create another. Wait for the human to act.

# Language

- All `analysis`, `reason`, and `concerns` fields: English (operator-facing).
- All `message_to_grower` and human task `title`/`reason`: Hebrew (grower-facing
  in the dashboard). Use natural, professional Hebrew.

# Response Schema

Respond with EXACTLY this JSON. No markdown. No prose around it.

```
{
  "analysis": "1-3 sentences: state of the system AND the cross-window evidence",
  "status": "healthy" | "attention" | "warning" | "critical",
  "actions": [
    {
      "channel": "nutrient_a" | "nutrient_b" | "ph_up" | "ph_down" | "supplement",
      "amount_ml": <number>,
      "reason": "why this dose, in English — must reference window evidence"
    }
  ],
  "human_tasks_to_create": [
    {
      "type": "water_change" | "dose_approval" | "system_reset" | "question" | "manual_action",
      "priority": "low" | "medium" | "high" | "urgent",
      "title": "<short Hebrew title>",
      "reason": "<Hebrew explanation for the grower>",
      "payload": { ... type-specific ... },
      "expires_in_hours": <number or null>
    }
  ],
  "next_check_minutes": <int, typically 60-360 for healthy, 5-30 for critical>,
  "message_to_grower": "<Hebrew, 1-2 sentences for the dashboard>",
  "concerns": ["<English bullet>", ...]
}
```

If no action and no task: `actions: []`, `human_tasks_to_create: []`. Always
output the full structure. Always be honest in `concerns`."""


# ---------------------------------------------------------------------------
# Window statistics
# ---------------------------------------------------------------------------

# Each window: (label, max_age_seconds)
WINDOWS = [
    ("5min", 5 * 60),
    ("1h",   60 * 60),
    ("6h",   6 * 60 * 60),
    ("24h",  24 * 60 * 60),
]

# Metrics we compute stats for
METRIC_FIELDS = ["ph", "ec", "tds", "orp", "water_temp", "salinity", "cf", "sg"]

# Display unit + decimal precision per metric
METRIC_DISPLAY = {
    "ph":         ("",       2),
    "ec":         ("μS/cm",  0),
    "tds":        ("ppm",    0),
    "orp":        ("mV",     0),
    "water_temp": ("°C",     1),
    "salinity":   ("PPM",    0),
    "cf":         ("",       2),
    "sg":         ("",       3),
}


def _values_for(readings: list[WaterReading], field: str) -> list[float]:
    out: list[float] = []
    for r in readings:
        v = getattr(r, field, None)
        if v is not None:
            out.append(float(v))
    return out


def _trend_per_hour(readings: list[WaterReading], field: str) -> Optional[float]:
    """Linear least-squares slope, expressed as units per hour. None if <3 pts."""
    points = [
        (r.timestamp, getattr(r, field, None))
        for r in readings
        if getattr(r, field, None) is not None
    ]
    if len(points) < 3:
        return None
    t0 = points[0][0]
    xs = [(t - t0).total_seconds() for t, _ in points]
    ys = [v for _, v in points]
    x_mean = sum(xs) / len(xs)
    y_mean = sum(ys) / len(ys)
    num = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    den = sum((x - x_mean) ** 2 for x in xs)
    if den == 0:
        return None
    slope_per_sec = num / den
    return slope_per_sec * 3600.0  # per-hour


def _window_stats(readings: list[WaterReading], field: str) -> Optional[dict]:
    values = _values_for(readings, field)
    if not values:
        return None
    n = len(values)
    median = statistics.median(values)
    mean = statistics.fmean(values)
    std = statistics.pstdev(values) if n >= 2 else 0.0
    trend = _trend_per_hour(readings, field) if n >= 3 else None
    return {
        "n": n,
        "median": median,
        "mean": mean,
        "std": std,
        "trend_per_hour": trend,
        "min": min(values),
        "max": max(values),
    }


def _is_anomaly(value: float, stats_1h: Optional[dict]) -> bool:
    """True if `value` is >3σ from the 1h median."""
    if stats_1h is None or stats_1h["n"] < 5 or stats_1h["std"] == 0:
        return False
    return abs(value - stats_1h["median"]) > 3.0 * stats_1h["std"]


def _filter_age(readings: list[WaterReading], max_age_seconds: int,
                now: datetime) -> list[WaterReading]:
    cutoff = now - timedelta(seconds=max_age_seconds)
    return [r for r in readings if r.timestamp >= cutoff]


def _format_value(value: float, field: str) -> str:
    _, digits = METRIC_DISPLAY.get(field, ("", 2))
    return f"{value:.{digits}f}"


def build_metric_table(
    current: WaterReading,
    recent_readings: list[WaterReading],
    now: Optional[datetime] = None,
) -> str:
    """Human-readable per-metric stats table with anomaly flags."""
    now = now or datetime.now()
    # Ensure current reading is included in the data, sorted ascending in time.
    all_readings = sorted([*recent_readings, current], key=lambda r: r.timestamp)

    lines = []
    for field in METRIC_FIELDS:
        cur_val = getattr(current, field, None)
        if cur_val is None and not _values_for(all_readings, field):
            continue
        unit, _ = METRIC_DISPLAY[field]
        unit_part = f" {unit}" if unit else ""
        lines.append(f"\n{field.upper()}:")

        # Current
        if cur_val is not None:
            stats_1h = _window_stats(_filter_age(all_readings, 3600, now), field)
            anomaly = "  [!] suspect — >3σ from 1h median" if _is_anomaly(cur_val, stats_1h) else ""
            lines.append(f"  now:  {_format_value(cur_val, field)}{unit_part}{anomaly}")
        else:
            lines.append(f"  now:  (no current reading)")

        # Windows
        for label, secs in WINDOWS:
            window_readings = _filter_age(all_readings, secs, now)
            stats = _window_stats(window_readings, field)
            if stats is None:
                lines.append(f"  {label:<5} (no data)")
                continue
            parts = [
                f"median={_format_value(stats['median'], field)}",
                f"σ={_format_value(stats['std'], field)}",
                f"n={stats['n']}",
            ]
            if stats["trend_per_hour"] is not None:
                trend = stats["trend_per_hour"]
                parts.append(f"trend={trend:+.3f}/h")
            lines.append(f"  {label:<5} {' · '.join(parts)}")

    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# USER PROMPT — per-cycle dynamic context
# ---------------------------------------------------------------------------

def build_analysis_prompt(
    current_reading: WaterReading,
    recent_readings: list[WaterReading],
    system_profile: dict,
    recent_actions: list[dict],
    available_channels: list[DoserChannel],
    pending_human_tasks: Optional[list[dict]] = None,
) -> str:
    """Build the per-cycle USER prompt. All dynamic context goes here."""
    pending_human_tasks = pending_human_tasks or []
    sections = []

    # --- Current state + window statistics ---
    sections.append("## Sensor Statistics (windowed — use these, not raw points)")
    sections.append(f"Current reading timestamp: {current_reading.timestamp.isoformat()}")
    sections.append(f"Source: {current_reading.source}")
    sections.append("")
    sections.append(build_metric_table(current_reading, recent_readings))
    sections.append("")

    # --- System instance profile ---
    sections.append("## System Instance")
    sections.append(f"  Type: {system_profile.get('system_type', 'nft_wall_mounted')}")
    sections.append(f"  Reservoir: {system_profile.get('reservoir_liters', 60)} liters")
    crop_type = system_profile.get('crop_type', 'lettuce')
    growth_stage = system_profile.get('growth_stage', 'vegetative')
    sections.append(f"  Crop: {crop_type}")
    sections.append(f"  Growth stage: {growth_stage}")
    sections.append(f"  Location: {system_profile.get('location', 'Tel Aviv, Israel')}")
    sections.append(f"  Outdoor: {system_profile.get('outdoor', True)}")
    sections.append("")

    # --- Cultivar protocol (Network Knowledge layer) ---
    # Resolve a cultivar-specific protocol if the system declares one; otherwise the
    # crop_type itself may match a species record. When neither resolves, the generic
    # crop prose in the SYSTEM_PROMPT carries the knowledge (legacy fallback).
    cultivar_id = system_profile.get('cultivar_id') or crop_type
    protocol = cultivars.protocol_block(cultivar_id, growth_stage)
    if protocol:
        sections.append(protocol)
        sections.append("")

    # --- Grow Context / Grower Memory / Episodes (optional) ---
    # Parity with the TS production Brain. These are per-grow dynamic state; the
    # TS dashboard owns them in Neon. When this Python agent is fed them via
    # system_profile (e.g. pushed through /api/system, or a future Neon sync),
    # it renders the same three layers so its reasoning matches.
    grow_context = _render_grow_context(system_profile.get('grow_profile'))
    if grow_context:
        sections.append(grow_context)
        sections.append("")
    grower_memory = _render_grower_memory(system_profile.get('grower_memory'))
    if grower_memory:
        sections.append(grower_memory)
        sections.append("")
    episodes = _render_episodes(system_profile.get('episodes'))
    if episodes:
        sections.append(episodes)
        sections.append("")

    # --- Recent dosing actions ---
    if recent_actions:
        sections.append("## Recent Dosing Actions (last 24h)")
        for action in recent_actions[-10:]:
            sections.append(
                f"  [{action.get('timestamp', '?')}] "
                f"{action.get('channel', '?')}: {action.get('amount_ml', '?')}ml "
                f"({'OK' if action.get('success') else 'FAILED'}) — "
                f"{action.get('reason', '')}"
            )
        sections.append("")
    else:
        sections.append("## Recent Dosing Actions")
        sections.append("  (none in the last 24h)")
        sections.append("")

    # --- Pending human tasks ---
    if pending_human_tasks:
        sections.append("## Currently Pending Human Tasks (do not duplicate these types)")
        for task in pending_human_tasks:
            sections.append(
                f"  #{task.get('id')} [{task.get('priority')}] "
                f"{task.get('type')}: {task.get('title')} "
                f"(created {task.get('created_at', '?')[:16]})"
            )
        sections.append("")
    else:
        sections.append("## Currently Pending Human Tasks")
        sections.append("  (none)")
        sections.append("")

    # --- Available channels ---
    sections.append("## Available Dosing Channels")
    for ch in available_channels:
        sections.append(f"  - {ch.value}")
    sections.append("")

    # --- Time context ---
    now = datetime.now()
    sections.append("## Time Context")
    sections.append(f"  Now: {now.strftime('%Y-%m-%d %H:%M')} ({now.strftime('%A')})")
    hour = now.hour
    if 6 <= hour < 10:
        period = "Early morning — plants starting photosynthesis"
    elif 10 <= hour < 16:
        period = "Peak daylight — highest uptake; outdoor TLV system gets hot"
    elif 16 <= hour < 20:
        period = "Late afternoon — uptake winding down"
    else:
        period = "Night — minimal uptake; safe maintenance window"
    sections.append(f"  Period: {period}")
    sections.append("")

    sections.append("## Your task")
    sections.append(
        "Analyze the cross-window evidence and respond with the JSON schema. "
        "Remember: act only when multiple windows agree on real drift; ignore "
        "anomaly-flagged points. Decisions are hourly-scale."
    )

    return "\n".join(sections)


# Crop targets retained for use by other modules / UI / future tooling.
CROP_DATABASE = {
    "lettuce":    {"pH": (5.5, 6.5), "EC": (800, 1200),  "TDS": (400, 600),  "water_temp": (18, 24)},
    "basil":      {"pH": (5.5, 6.5), "EC": (1000, 1600), "TDS": (500, 800),  "water_temp": (18, 26)},
    "spinach":    {"pH": (6.0, 7.0), "EC": (1200, 1800), "TDS": (600, 900),  "water_temp": (16, 22)},
    "strawberry": {"pH": (5.5, 6.2), "EC": (1000, 1500), "TDS": (500, 750),  "water_temp": (18, 24)},
    "tomato":     {"pH": (5.8, 6.8), "EC": (2000, 3500), "TDS": (1000, 1750),"water_temp": (18, 26)},
}


def get_crop_targets(crop: str, stage: str = "vegetative") -> dict:
    """
    Resolve target ranges for a crop or cultivar id. Prefers the cultivar registry
    (cultivar > species), falling back to the legacy CROP_DATABASE, then lettuce.
    """
    registry_targets = cultivars.targets_for(crop, stage)
    if registry_targets:
        return registry_targets
    return CROP_DATABASE.get(crop, CROP_DATABASE["lettuce"])


# ---------------------------------------------------------------------------
# Grow Context / Grower Memory / Episodes — renderers, mirroring the TS
# production Brain (web/src/lib/grow-profile.ts + grower-memory.ts). These take
# plain dicts/lists pulled from system_profile so the Python agent can render
# the same three knowledge layers when it's fed them.
# ---------------------------------------------------------------------------

def _render_grow_context(profile: Optional[dict]) -> Optional[str]:
    if not profile:
        return None
    lines = ["## Grow Context — the personal Brain of this grow"]
    known = []
    if profile.get("water_source"):
        known.append(f"  Water source: {profile['water_source']}")
    wb = profile.get("water_baseline") or {}
    if wb.get("ph") is not None or wb.get("ec") is not None:
        parts = []
        if wb.get("ph") is not None:
            parts.append(f"pH {wb['ph']}")
        if wb.get("ec") is not None:
            parts.append(f"EC {wb['ec']} μS/cm")
        known.append(f"  Source-water baseline (pre-nutrient): {', '.join(parts)}")
    if profile.get("light"):
        known.append(f"  Light: {profile['light']}")
    if profile.get("climate"):
        known.append(f"  Climate / exposure: {profile['climate']}")
    if profile.get("business_goal"):
        known.append(f"  Goal: {profile['business_goal']}")
    if profile.get("target_buyer"):
        known.append(f"  Target buyer: {profile['target_buyer']}")
    practices = profile.get("practices") or []
    if practices:
        known.append("  Grower practices to account for:")
        known.extend(f"    - {p}" for p in practices)
    if not known:
        return None
    lines.extend(known)
    return "\n".join(lines)


def _render_grower_memory(entries: Optional[list]) -> Optional[str]:
    if not entries:
        return None
    lines = [
        "## Grower Memory — what the grower has taught the Brain about this grow",
        "(Authoritative over your general knowledge for THIS grow. NEVER overrides the safety hard-limits.)",
    ]
    for e in entries:
        kind = e.get("kind", "fact")
        text = e.get("text", "")
        lines.append(f"  - [{kind}] {text}")
    return "\n".join(lines)


def _render_episodes(episodes: Optional[list]) -> Optional[str]:
    if not episodes:
        return None
    lines = [
        "## Recent Episodes — what you (the Brain) did on recent cycles, newest first",
        "(Your own continuity. Use it to avoid re-deciding the same thing and to notice whether past actions worked.)",
    ]
    for e in episodes:
        ts = str(e.get("ts", ""))[:16].replace("T", " ")
        status = e.get("status")
        summary = e.get("summary", "")
        tag = f"{ts} · {status}" if status else ts
        lines.append(f"  - [{tag}] {summary}")
    return "\n".join(lines)
