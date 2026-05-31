/**
 * Per-system target ranges with tolerance bands.
 *
 * pH naturally drifts ±0.2-0.4 across a normal day in an NFT system:
 *  - Photosynthesis (CO2 uptake) raises pH during peak daylight 10:00-16:00
 *  - Respiration (CO2 release) lowers pH at night and very early morning
 *  - Higher water temperatures accelerate both processes, widening the swing
 *  - Nutrient uptake patterns (cation/anion imbalance) add their own drift
 *
 * Treating every small fluctuation as a problem leads to over-correction,
 * pH oscillation, and the exact runaway-dosing failure mode that emptied
 * POC v02's pH Down bottle overnight.  The right answer is a dead-band
 * controller: define a tolerance around the setpoint, ignore everything
 * inside it, only consider action when readings are SUSTAINED outside.
 *
 * Two layers, separate concerns:
 *  - CROP_DEFAULTS — sane band per crop, applied unless the grower
 *    overrides via systems.target_ranges JSONB.
 *  - evaluateMetric — given a value + target + tolerance, returns
 *    'within' | 'edge' | 'outside' so the brain prompt and cycle gate
 *    can both reason consistently.
 */
import type { SystemRow } from "./db";
import { cultivarTargets } from "./cultivars";

export type MetricTarget = {
  /** Setpoint we steer toward.  E.g. 6.0 for basil pH, 1900 for basil veg EC. */
  target: number;
  /**
   * Tolerance band — half-width of the comfortable zone.  Specified in
   * EITHER absolute units (pH, water_temp) or as a percent of the target
   * (EC, where 15% of 2000 = ±300).
   */
  tolerance: number;
  /** Whether `tolerance` is in absolute units or % of target. */
  tolerance_mode: "absolute" | "percent";
};

export type TargetRanges = {
  ph?: MetricTarget;
  ec?: MetricTarget;
  water_temp?: MetricTarget;
};

/**
 * Crop-by-stage defaults.  These are the bands we apply if the grower
 * hasn't explicitly written target_ranges to their system row.  Sources:
 * standard hydroponic references for each crop, picked toward the wider
 * end so we don't over-correct on normal diurnal drift.
 */
export const CROP_DEFAULTS: Record<
  string,
  Record<string, TargetRanges>
> = {
  lettuce: {
    seedling:   { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 800,  tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 20, tolerance: 4, tolerance_mode: "absolute" } },
    vegetative: { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1000, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 21, tolerance: 4, tolerance_mode: "absolute" } },
    flowering:  { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1100, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 21, tolerance: 4, tolerance_mode: "absolute" } },
    fruiting:   { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1100, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 21, tolerance: 4, tolerance_mode: "absolute" } },
  },
  basil: {
    seedling:   { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1000, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 22, tolerance: 4, tolerance_mode: "absolute" } },
    vegetative: { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1900, tolerance: 15, tolerance_mode: "percent" }, water_temp: { target: 22, tolerance: 4, tolerance_mode: "absolute" } },
    flowering:  { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1700, tolerance: 15, tolerance_mode: "percent" }, water_temp: { target: 22, tolerance: 4, tolerance_mode: "absolute" } },
    fruiting:   { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1700, tolerance: 15, tolerance_mode: "percent" }, water_temp: { target: 22, tolerance: 4, tolerance_mode: "absolute" } },
  },
  spinach: {
    seedling:   { ph: { target: 6.5, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1200, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 19, tolerance: 3, tolerance_mode: "absolute" } },
    vegetative: { ph: { target: 6.5, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1500, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 19, tolerance: 3, tolerance_mode: "absolute" } },
    flowering:  { ph: { target: 6.5, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1500, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 19, tolerance: 3, tolerance_mode: "absolute" } },
    fruiting:   { ph: { target: 6.5, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1500, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 19, tolerance: 3, tolerance_mode: "absolute" } },
  },
  strawberry: {
    seedling:   { ph: { target: 5.8, tolerance: 0.3, tolerance_mode: "absolute" }, ec: { target: 1000, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 20, tolerance: 4, tolerance_mode: "absolute" } },
    vegetative: { ph: { target: 5.8, tolerance: 0.3, tolerance_mode: "absolute" }, ec: { target: 1300, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 20, tolerance: 4, tolerance_mode: "absolute" } },
    flowering:  { ph: { target: 5.8, tolerance: 0.3, tolerance_mode: "absolute" }, ec: { target: 1500, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 20, tolerance: 4, tolerance_mode: "absolute" } },
    fruiting:   { ph: { target: 5.8, tolerance: 0.3, tolerance_mode: "absolute" }, ec: { target: 1700, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 20, tolerance: 4, tolerance_mode: "absolute" } },
  },
  tomato: {
    seedling:   { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 1500, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 22, tolerance: 4, tolerance_mode: "absolute" } },
    vegetative: { ph: { target: 6.0, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 2000, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 22, tolerance: 4, tolerance_mode: "absolute" } },
    flowering:  { ph: { target: 6.2, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 2500, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 22, tolerance: 4, tolerance_mode: "absolute" } },
    fruiting:   { ph: { target: 6.2, tolerance: 0.4, tolerance_mode: "absolute" }, ec: { target: 3000, tolerance: 20, tolerance_mode: "percent" }, water_temp: { target: 22, tolerance: 4, tolerance_mode: "absolute" } },
  },
};

const FALLBACK: TargetRanges = {
  ph: { target: 6.0, tolerance: 0.5, tolerance_mode: "absolute" },
  ec: { target: 1200, tolerance: 25, tolerance_mode: "percent" },
  water_temp: { target: 22, tolerance: 5, tolerance_mode: "absolute" },
};

/**
 * Compose the effective target ranges for a system, honouring the precedence
 * law (NEXTGEN-ARCHITECTURE.md §2):
 *   grower override (target_ranges) > cultivar protocol (registry) >
 *   crop+stage default (CROP_DEFAULTS) > generic fallback.
 * The cultivar layer is resolved from the shared registry by cultivar_id, or by
 * crop_type when it names a registry record. Always returns a fully-populated
 * object.
 */
export function getEffectiveTargets(sys: Pick<SystemRow, "crop_type" | "growth_stage" | "target_ranges" | "cultivar_id">): TargetRanges {
  const stage = sys.growth_stage ?? "vegetative";
  const fromRegistry = cultivarTargets(sys.cultivar_id ?? sys.crop_type, stage);
  const cropMap = CROP_DEFAULTS[sys.crop_type ?? "lettuce"] ?? CROP_DEFAULTS.lettuce;
  const stageDefault = cropMap[stage] ?? cropMap.vegetative;
  const override = (sys.target_ranges ?? {}) as TargetRanges;
  return {
    ph: override.ph ?? fromRegistry?.ph ?? stageDefault.ph ?? FALLBACK.ph,
    ec: override.ec ?? fromRegistry?.ec ?? stageDefault.ec ?? FALLBACK.ec,
    water_temp: override.water_temp ?? fromRegistry?.water_temp ?? stageDefault.water_temp ?? FALLBACK.water_temp,
  };
}

/**
 * Absolute half-width of the tolerance band, regardless of whether the
 * metric uses absolute or percent units.
 */
export function bandWidth(target: MetricTarget): number {
  return target.tolerance_mode === "percent"
    ? (target.target * target.tolerance) / 100
    : target.tolerance;
}

export type MetricEvaluation = {
  status: "within" | "edge" | "outside" | "no_data";
  /** Lower bound of the comfortable band. */
  band_low: number;
  /** Upper bound of the comfortable band. */
  band_high: number;
  /** Signed distance from target, expressed as fraction of the band width. */
  distance_in_bands: number | null;
};

/**
 * Classify a reading against its tolerance band.
 *   - within (|distance| ≤ 1 band) — comfortable; do NOT propose dosing.
 *   - edge   (1 < |distance| ≤ 1.5 bands) — at the boundary; act only on sustained drift.
 *   - outside (> 1.5 bands)        — outside band; consider correction.
 */
export function evaluateMetric(
  value: number | null | undefined,
  m: MetricTarget
): MetricEvaluation {
  const w = bandWidth(m);
  const band_low = m.target - w;
  const band_high = m.target + w;
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { status: "no_data", band_low, band_high, distance_in_bands: null };
  }
  const distance = (value - m.target) / w;
  let status: MetricEvaluation["status"];
  if (Math.abs(distance) <= 1) status = "within";
  else if (Math.abs(distance) <= 1.5) status = "edge";
  else status = "outside";
  return { status, band_low, band_high, distance_in_bands: distance };
}

/**
 * Diurnal expectation — a short human-readable hint about what's "normal"
 * pH drift at this time of day in an outdoor NFT system.  Used in the
 * brain prompt so Claude doesn't react to expected daily rhythm.
 */
export function diurnalContext(now: Date = new Date()): {
  period: string;
  expected_ph_drift: string;
} {
  const h = now.getHours();
  if (h >= 6 && h < 10) {
    return {
      period: "morning ramp-up",
      expected_ph_drift:
        "pH typically rising 0.1-0.3 as photosynthesis ramps up and CO2 is consumed. Slightly upward drift is normal here.",
    };
  }
  if (h >= 10 && h < 16) {
    return {
      period: "peak photosynthesis",
      expected_ph_drift:
        "pH naturally hits its daily peak. Drift of +0.2-0.4 above morning baseline is expected and not a problem unless sustained the next morning too.",
    };
  }
  if (h >= 16 && h < 20) {
    return {
      period: "afternoon wind-down",
      expected_ph_drift:
        "pH starting to settle as photosynthesis slows. Slow downward drift toward evening is expected.",
    };
  }
  return {
    period: "night respiration",
    expected_ph_drift:
      "pH drifts downward as plants respire and release CO2 into the water. Drops of 0.2-0.4 by early morning are normal — do NOT correct overnight unless pH crosses the outside-band threshold.",
  };
}
