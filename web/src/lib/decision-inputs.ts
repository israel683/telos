/**
 * Decision influences — the structured snapshot of WHAT drove an autonomous
 * decision, persisted alongside the reasoning (`analysis`) on `ai_decisions`.
 *
 * The brand asks: "ממה מושפעת החלטה, ומה הריזונינג מאחוריה?" The reasoning
 * (`analysis`) answered the second; this answers the first. It captures the
 * inputs the cycle ALREADY gathers — the gate trigger that woke it, the live
 * reading, drift vs. the last decision, the tolerance bands in force, the
 * cultivar + stage, execution authority, and low bottles — so `/decisions` can
 * show, per row, the influences that produced it.
 *
 * Cheap by construction: built from data the cycle holds in hand (no extra DB
 * round-trips). See NEXTGEN-ARCHITECTURE-V2.md §2.3.
 */
import type { WaterReading } from "./db";
import { evaluateMetric, type MetricTarget, type TargetRanges } from "./tolerance";

/** Below this remaining-ml a channel counts as a low-bottle influence. */
const LOW_BOTTLE_ML = 20;
/** …or below this fraction of its declared capacity. */
const LOW_BOTTLE_FRACTION = 0.15;

export type DecisionInputs = {
  /** Why this cycle ran at all (gate trigger, or the grower action that forced it). */
  trigger: string;
  /** cron | reeval-<source> — who initiated this decision. */
  source: string;
  /** The live reading the decision reasoned on (+ its age in seconds). */
  current: {
    ph: number | null;
    ec: number | null;
    water_temp: number | null;
    age_seconds: number;
  } | null;
  /** Absolute change vs. the reading at the previous decision (drift), when known. */
  drift: { ph?: number; ec?: number; water_temp?: number } | null;
  /** Effective tolerance bands [low, high] the decision was judged against. */
  bands: { ph?: [number, number]; ec?: [number, number]; water_temp?: [number, number] } | null;
  /** What we're growing — the cultivar/crop + stage that set the targets. */
  cultivar: { id: string | null; crop: string; stage: string };
  /** Execution authority in force this cycle (does a dose fire or queue?). */
  authority: { autonomous_dosing: boolean; doser_verified: boolean };
  /** Channels flagged low on liquid — they constrain what the Brain can propose. */
  bottles_low: string[];
  /** How many human tasks were already pending (a pending high-pri one wakes the gate). */
  pending_tasks: number;
};

function band(value: number | null | undefined, target: MetricTarget | undefined):
  [number, number] | undefined {
  if (value == null || !target) return undefined;
  const ev = evaluateMetric(value, target);
  return [Number(ev.band_low.toFixed(2)), Number(ev.band_high.toFixed(2))];
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function buildDecisionInputs(opts: {
  trigger: string;
  source: string;
  current: WaterReading | null;
  reference: WaterReading | null;
  targets: TargetRanges | undefined;
  cultivarId: string | null;
  crop: string;
  stage: string;
  autonomousDosing: boolean;
  doserVerified: boolean;
  bottleLevels: Record<string, number> | null;
  bottleCapacities: Record<string, number> | null;
  pendingTasks: number;
}): DecisionInputs {
  const { current, reference, targets } = opts;

  const currentSnap = current
    ? {
        ph: current.ph,
        ec: current.ec,
        water_temp: current.water_temp,
        age_seconds: Math.max(0, Math.round((Date.now() - current.ts.getTime()) / 1000)),
      }
    : null;

  let drift: DecisionInputs["drift"] = null;
  if (current && reference) {
    const d: { ph?: number; ec?: number; water_temp?: number } = {};
    if (current.ph != null && reference.ph != null) d.ph = round(Math.abs(current.ph - reference.ph), 2);
    if (current.ec != null && reference.ec != null) d.ec = round(Math.abs(current.ec - reference.ec), 0);
    if (current.water_temp != null && reference.water_temp != null)
      d.water_temp = round(Math.abs(current.water_temp - reference.water_temp), 1);
    if (Object.keys(d).length) drift = d;
  }

  let bands: DecisionInputs["bands"] = null;
  if (current && targets) {
    const b: NonNullable<DecisionInputs["bands"]> = {};
    const ph = band(current.ph, targets.ph);
    const ec = band(current.ec, targets.ec);
    const wt = band(current.water_temp, targets.water_temp);
    if (ph) b.ph = ph;
    if (ec) b.ec = ec;
    if (wt) b.water_temp = wt;
    if (Object.keys(b).length) bands = b;
  }

  const bottles_low: string[] = [];
  if (opts.bottleLevels) {
    for (const [ch, ml] of Object.entries(opts.bottleLevels)) {
      if (ml == null) continue;
      const cap = opts.bottleCapacities?.[ch];
      if (ml <= LOW_BOTTLE_ML || (cap && cap > 0 && ml / cap < LOW_BOTTLE_FRACTION)) {
        bottles_low.push(ch);
      }
    }
  }

  return {
    trigger: opts.trigger,
    source: opts.source,
    current: currentSnap,
    drift,
    bands,
    cultivar: { id: opts.cultivarId, crop: opts.crop, stage: opts.stage },
    authority: { autonomous_dosing: opts.autonomousDosing, doser_verified: opts.doserVerified },
    bottles_low,
    pending_tasks: opts.pendingTasks,
  };
}
