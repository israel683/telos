/**
 * Cycle gate — local pre-check that decides whether the autonomous cron
 * should actually invoke Claude this tick, or skip the LLM and log a cheap
 * "stable, no decision needed" record.
 *
 * Design rationale: the cron fires every 2 hours, but a 60L NFT reservoir
 * simply doesn't change meaningfully in that window when things are healthy.  Token
 * spend on `analyzeAndDecide` for those quiet hours is pure waste — and
 * the Claude response *itself* tells us "check again in 2-6 hours" when
 * status=healthy.  This gate honours that hint and adds a delta-based
 * sanity check on the sensor reading so we never sleep through a real
 * drift event.
 *
 * IMPORTANT: this gate is conservative.  Any of the BYPASS conditions
 * force a full LLM cycle regardless of timing.  We'd rather burn a few
 * extra tokens than miss a pH excursion.
 */
import type { WaterReading } from "./db";
import type { TargetRanges } from "./tolerance";
import { evaluateMetric } from "./tolerance";

/** Tunable thresholds — kept here so they're easy to audit. */
export const CYCLE_GATE = {
  // Sensor staleness — if last reading is older than this we MUST run a
  // full cycle so Claude sees that the system is blind.
  max_sensor_age_seconds: 10 * 60,

  // Hard "must run an LLM cycle" sensor envelopes.  These are tighter than
  // SafetyController bounds on purpose: we want Claude in the loop BEFORE
  // we're up against a safety cliff.
  ph_critical_low: 5.0,
  ph_critical_high: 7.5,
  ec_critical_low: 200,
  ec_critical_high: 3000,
  water_temp_critical_low: 10,
  // Force a wake only near the real danger cliff (SafetyController blocks all
  // dosing at 35°C). Routine structural heat in the low-30s is expected for an
  // outdoor/south-facing rig — it gets noted on the next normal cycle, not a
  // dedicated alarm every tick.
  water_temp_critical_high: 34,

  // Stability thresholds: if the current reading differs by no more than
  // these from the reading at the time of the last decision, we consider
  // the system "drift-free since last analysis".
  ph_stable_delta: 0.15,
  ec_stable_delta: 75,
  water_temp_stable_delta: 1.5,

  // After a SKIP decision we still want to re-evaluate sooner than a normal
  // healthy next_check (Claude wasn't in the loop to say otherwise), so the
  // gate clamps the post-skip next-check to this value.
  post_skip_recheck_minutes: 120,
} as const;

export type GateInput = {
  /** Most recent sensor reading for the system. */
  current: WaterReading;
  /** Reading captured at the time of the previous LLM decision, if any. */
  referenceReading: WaterReading | null;
  /** When the system is next allowed to invoke Claude (from systems.next_check_at). */
  nextCheckAt: Date | null;
  /** Count of pending human tasks (any urgent/high triggers a full cycle). */
  pendingHighPriorityCount: number;
  /** Last decision status — used to decide whether to honour a long skip. */
  lastDecisionStatus: string | null;
  /**
   * Effective tolerance bands for this system (crop+stage defaults
   * shallow-merged with per-system overrides).  When provided, the gate
   * uses band-aware classification ("within / edge / outside") instead
   * of fixed critical thresholds — meaning the cycle runs only when
   * readings escape the comfortable band, not on every small fluctuation.
   */
  targets?: TargetRanges;
};

/**
 * Which model tier should reason this cycle.
 *  - `light`: the routine proactive review while everything is calm + in-band —
 *    a cheap, frequent look (a small/fast model).
 *  - `heavy`: a real reason to think hard — an excursion (critical / out-of-band /
 *    drift), an unhealthy prior, a pending high-priority task, the first cycle, or
 *    a grower action. The smart model. The light tier may also ESCALATE to heavy
 *    (the "refinement round") when it finds it actually wants to act — see cycle.ts.
 */
export type BrainTier = "light" | "heavy";

export type GateDecision =
  | {
      run_llm: true;
      reason: string;
      tier: BrainTier;
    }
  | {
      run_llm: false;
      skip_reason: string;
      next_check_minutes: number;
    };

function critical(current: WaterReading): string | null {
  if (current.ph !== null) {
    if (current.ph < CYCLE_GATE.ph_critical_low) return `pH=${current.ph.toFixed(2)} below critical-low`;
    if (current.ph > CYCLE_GATE.ph_critical_high) return `pH=${current.ph.toFixed(2)} above critical-high`;
  }
  if (current.ec !== null) {
    if (current.ec < CYCLE_GATE.ec_critical_low) return `EC=${current.ec.toFixed(0)} below critical-low`;
    if (current.ec > CYCLE_GATE.ec_critical_high) return `EC=${current.ec.toFixed(0)} above critical-high`;
  }
  if (current.water_temp !== null) {
    if (current.water_temp < CYCLE_GATE.water_temp_critical_low)
      return `water_temp=${current.water_temp.toFixed(1)}°C below critical-low`;
    if (current.water_temp > CYCLE_GATE.water_temp_critical_high)
      return `water_temp=${current.water_temp.toFixed(1)}°C above critical-high`;
  }
  return null;
}

/**
 * Band-aware classification.  Returns a non-null reason ONLY when at
 * least one metric is "outside" its tolerance band — which is the
 * threshold we now use to wake the brain.  Edge/within readings are
 * considered routine drift and don't justify the LLM cost.
 *
 * Diurnal expectation is implicit: the bands already account for normal
 * day/night drift (pH ±0.4 covers the typical photosynthesis swing).
 */
function outsideBand(current: WaterReading, targets: TargetRanges | undefined): string | null {
  if (!targets) return null;
  if (targets.ph && current.ph !== null) {
    const ev = evaluateMetric(current.ph, targets.ph);
    if (ev.status === "outside") {
      return `pH=${current.ph.toFixed(2)} outside band [${ev.band_low.toFixed(2)}, ${ev.band_high.toFixed(2)}]`;
    }
  }
  if (targets.ec && current.ec !== null) {
    const ev = evaluateMetric(current.ec, targets.ec);
    if (ev.status === "outside") {
      return `EC=${current.ec.toFixed(0)} outside band [${ev.band_low.toFixed(0)}, ${ev.band_high.toFixed(0)}]`;
    }
  }
  // water_temp is deliberately NOT a wake trigger here. We can't dose it away,
  // and for an outdoor/south-facing rig high midday temp is STRUCTURAL — waking
  // the brain on it every cycle just re-alerts something the grower can't fix
  // (and burns compute). The truly dangerous end is still caught by the
  // critical() envelope below; otherwise temp is surfaced whenever the brain
  // runs for a real reason (pH/EC drift, or the proactive review).
  return null;
}

function driftAgainstReference(
  current: WaterReading,
  ref: WaterReading
): string | null {
  if (current.ph !== null && ref.ph !== null) {
    const d = Math.abs(current.ph - ref.ph);
    if (d > CYCLE_GATE.ph_stable_delta) return `|Δ pH|=${d.toFixed(2)} > ${CYCLE_GATE.ph_stable_delta}`;
  }
  if (current.ec !== null && ref.ec !== null) {
    const d = Math.abs(current.ec - ref.ec);
    if (d > CYCLE_GATE.ec_stable_delta) return `|Δ EC|=${d.toFixed(0)} > ${CYCLE_GATE.ec_stable_delta}`;
  }
  if (current.water_temp !== null && ref.water_temp !== null) {
    const d = Math.abs(current.water_temp - ref.water_temp);
    if (d > CYCLE_GATE.water_temp_stable_delta)
      return `|Δ water_temp|=${d.toFixed(1)} > ${CYCLE_GATE.water_temp_stable_delta}`;
  }
  return null;
}

/**
 * Pure function: given the gate inputs, return whether we should pay the
 * tokens for a full LLM cycle right now.
 */
export function evaluateCycleGate(input: GateInput): GateDecision {
  const now = Date.now();

  // BYPASS 1: stale sensor → Claude needs to see that we're flying blind.
  const sensorAgeSec = (now - input.current.ts.getTime()) / 1000;
  if (sensorAgeSec > CYCLE_GATE.max_sensor_age_seconds) {
    return { run_llm: true, reason: `sensor stale (${sensorAgeSec.toFixed(0)}s)`, tier: "heavy" };
  }

  // BYPASS 2: current reading is in a critical envelope (safety bounds).
  const crit = critical(input.current);
  if (crit) {
    return { run_llm: true, reason: `critical: ${crit}`, tier: "heavy" };
  }

  // BYPASS 2.5: reading is outside the per-system TOLERANCE band (looser
  // than safety bounds, tighter than critical).  This is the dead-band
  // controller: if pH/EC/temp drifts outside the comfortable zone, the
  // brain runs.  If they're within the band — even if not exactly at
  // target — we DON'T wake the brain, since the natural diurnal swing
  // is normal and correcting it would chase noise.
  const band = outsideBand(input.current, input.targets);
  if (band) {
    return { run_llm: true, reason: `outside tolerance band: ${band}`, tier: "heavy" };
  }

  // BYPASS 3: pending urgent/high task and we haven't reasoned since.
  if (input.pendingHighPriorityCount > 0) {
    return {
      run_llm: true,
      reason: `pending high-priority human tasks: ${input.pendingHighPriorityCount}`,
      tier: "heavy",
    };
  }

  // BYPASS 4: no prior decision at all — first cycle for this system.
  if (!input.referenceReading) {
    return { run_llm: true, reason: "no prior decision (first cycle)", tier: "heavy" };
  }

  // BYPASS 5: prior decision wasn't healthy → don't fall asleep on a
  // warning/attention/critical state.
  if (
    input.lastDecisionStatus &&
    !["healthy", "skipped"].includes(input.lastDecisionStatus)
  ) {
    return {
      run_llm: true,
      reason: `last decision status was '${input.lastDecisionStatus}' (re-evaluate)`,
      tier: "heavy",
    };
  }

  // BYPASS 6: sensor drift since the last decision's reference reading.
  const drift = driftAgainstReference(input.current, input.referenceReading);
  if (drift) {
    return { run_llm: true, reason: `drift detected: ${drift}`, tier: "heavy" };
  }

  // SKIP path: respect next_check_at from the previous LLM cycle.
  if (input.nextCheckAt && now < input.nextCheckAt.getTime()) {
    const remainingMin = Math.ceil((input.nextCheckAt.getTime() - now) / 60_000);
    return {
      run_llm: false,
      skip_reason: `stable; honouring next_check_at (${remainingMin}min remaining)`,
      next_check_minutes: Math.max(remainingMin, CYCLE_GATE.post_skip_recheck_minutes),
    };
  }

  // SKIP path: next_check_at has elapsed but the system is still flat.
  // Re-run the Brain — it's been long enough since we asked.  This is the
  // ROUTINE proactive review: nothing is wrong, so the LIGHT tier handles it.
  // (It escalates to heavy on its own if it finds it actually wants to act.)
  return { run_llm: true, reason: "next_check_at elapsed (periodic check-in)", tier: "light" };
}
