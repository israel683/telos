/**
 * Telos Safety Controller — the LAST LINE OF DEFENSE before any dose reaches
 * hardware. These limits are NOT negotiable by the AI.
 *
 * The controller is now per-system: it consults the system's DosingConfig
 * (see lib/dosing-config.ts) to know which channels exist, and which roles
 * (ph_up / ph_down / fertilizer) they fill.  pH-out-of-bounds responses
 * branch on what's available:
 *
 *   - pH < min and ph_up exists      → allow only the ph_up channel
 *   - pH < min and no ph_up          → block all dosing (manual fix required)
 *   - pH > max and ph_down exists    → allow only the ph_down channel
 *   - pH > max and no ph_down        → block all dosing (manual fix required)
 *
 * EC overruns block "fertilizer" role channels regardless of brand.
 */
import { getRecentActions, getSystem, DEFAULT_SYSTEM_ID } from "./db";
import type { WaterReading } from "./db";
import {
  getDosingConfig,
  type DosingConfig,
  hasPhUp,
  hasPhDown,
  phUpKey,
  phDownKey,
} from "./dosing-config";

/**
 * Minimum residual ml in a bottle below which we refuse to dose from it.
 * Below this the pump may spin but the pickup tube is sucking air, which
 * is exactly the failure mode that emptied the POC v02 install overnight.
 */
export const MIN_BOTTLE_ML_TO_DOSE = 15;

/** Hard cap on total ml dosed in a 24h window before doser_verified. */
export const PRE_VERIFY_DAILY_TOTAL_ML = 30;
/** Hard cap on total ml dosed in a 24h window after doser_verified. */
export const VERIFIED_DAILY_TOTAL_ML = 250;

/**
 * pH is a once-a-day decision. After ANY pH correction (either direction), no
 * further pH dose is allowed for this many hours — the hard backstop against
 * the pH-up/pH-down oscillation that has emptied a bottle overnight in this
 * system. ~20h ≈ "once per day" while tolerating a slightly-early next-day
 * window. Overridden only by an explicit grower action after a real change
 * (water swap / top-off), via command.ph_override.
 */
export const PH_DECISION_COOLDOWN_HOURS = 20;

export const SAFETY_LIMITS = {
  // pH absolute bounds — outside this range, only the corrective channel allowed
  ph_min: 4.5,
  ph_max: 8.0,
  // pH target range — normal operating range (informational; not enforced)
  ph_target_min: 5.5,
  ph_target_max: 6.5,
  // EC bounds (μS/cm)
  ec_min: 100,
  ec_max: 3500,
  // Water temperature bounds (°C)
  water_temp_min: 5.0,
  water_temp_max: 35.0,
  // Per-dose limits
  max_single_dose_ml: 50.0,
  max_hourly_dose_ml_per_channel: 150.0,
  // 60s between *treatment* doses on the same channel.  Priming doses are
  // exempted via the reason-string sentinel below, so a "prime then dose"
  // sequence in chat doesn't get blocked by this guard.  60s gives the pump
  // time to settle and a few sensor samples to drift; tighter than the old
  // 120s because in chat the grower is actively watching and steering.
  min_dose_interval_seconds: 60,
  // If no sensor reading for this long, block all dosing (seconds)
  max_sensor_age_seconds: 300,
} as const;

/**
 * `DoserChannel` is now a free string — the universe of valid keys depends
 * on the active system's DosingConfig.  Validation happens in
 * `validateCommand` against the resolved config.
 */
export type DoserChannel = string;

export type DosingCommand = {
  channel: DoserChannel;
  amount_ml: number;
  reason: string;
  confidence?: number;
  /**
   * Set to TRUE only by the dedicated `primeChannel` / doser-protocol code
   * paths (server-side, not by free-text reason strings).  Priming doses
   * are tube-fill events that don't change the reservoir and are exempt
   * from the per-channel interval and per-hour quota.  Free-text "this
   * is priming!" in `reason` is NO LONGER trusted — the old bypass let
   * the autonomous brain inject reasons that read like priming and skip
   * safety, which we've seen in production.
   */
  is_priming?: boolean;
  /**
   * Set TRUE only by an explicit grower action (chat) after a real disruption
   * such as a water change / top-off — lifts the once-a-day pH cooldown for
   * this single dose. The autonomous cron path NEVER sets this, so the
   * autonomous brain can't bypass the once-a-day pH discipline.
   */
  ph_override?: boolean;
};

export type SafetyValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validates a single dose command against current reading + recent dosing
 * history. Returns ok:true to allow, or ok:false with a reason to block.
 *
 * If `dosingConfig` is not provided, it's looked up for `systemId`.  Callers
 * that already hold a config (the brain) should pass it to avoid an extra
 * DB round-trip per validation.
 */
export async function validateCommand(
  command: DosingCommand,
  currentReading: WaterReading | null,
  opts: {
    systemId?: string;
    dosingConfig?: DosingConfig;
  } = {}
): Promise<SafetyValidation> {
  const systemId = opts.systemId ?? DEFAULT_SYSTEM_ID;
  const cfg = opts.dosingConfig ?? (await getDosingConfig(systemId));

  // 0. Channel must exist on this rig.
  if (!cfg.assignments[command.channel]) {
    return {
      ok: false,
      reason:
        `Unknown channel '${command.channel}' on this system. ` +
        `Configured: ${Object.keys(cfg.assignments).join(", ") || "(none)"}.`,
    };
  }
  const assignment = cfg.assignments[command.channel];
  const isFertilizer = assignment.role === "fertilizer";
  const isPhUp = assignment.role === "ph_up";
  const isPhDown = assignment.role === "ph_down";

  // 1. Sensor freshness
  if (currentReading === null) {
    return { ok: false, reason: "No sensor reading available — refusing to dose blind" };
  }
  const age = (Date.now() - currentReading.ts.getTime()) / 1000;
  if (age > SAFETY_LIMITS.max_sensor_age_seconds) {
    return {
      ok: false,
      reason: `Sensor reading is ${age.toFixed(0)}s old (max ${SAFETY_LIMITS.max_sensor_age_seconds}s)`,
    };
  }

  // 2. pH absolute bounds — branch on which corrective channels exist.
  if (currentReading.ph !== null) {
    if (currentReading.ph < SAFETY_LIMITS.ph_min) {
      if (!hasPhUp(cfg)) {
        return {
          ok: false,
          reason:
            `pH=${currentReading.ph.toFixed(2)} is critically low — no pH Up channel on this rig; ` +
            `manual intervention required`,
        };
      }
      if (!isPhUp) {
        const k = phUpKey(cfg);
        return {
          ok: false,
          reason: `pH=${currentReading.ph.toFixed(2)} is critically low — only ${k ?? "pH Up"} channel allowed`,
        };
      }
    }
    if (currentReading.ph > SAFETY_LIMITS.ph_max) {
      if (!hasPhDown(cfg)) {
        return {
          ok: false,
          reason:
            `pH=${currentReading.ph.toFixed(2)} is critically high — no pH Down channel on this rig; ` +
            `manual intervention required`,
        };
      }
      if (!isPhDown) {
        const k = phDownKey(cfg);
        return {
          ok: false,
          reason: `pH=${currentReading.ph.toFixed(2)} is critically high — only ${k ?? "pH Down"} channel allowed`,
        };
      }
    }
  }

  // 3. EC bounds — block fertilizer-role doses when EC exceeds max.
  // pH channels are allowed even at high EC (they correct pH, not feed).
  if (
    currentReading.ec !== null &&
    currentReading.ec > SAFETY_LIMITS.ec_max &&
    isFertilizer
  ) {
    return {
      ok: false,
      reason: `EC=${currentReading.ec.toFixed(0)} exceeds max — blocking nutrient dose`,
    };
  }

  // 4. Water temperature
  if (currentReading.water_temp !== null) {
    if (currentReading.water_temp > SAFETY_LIMITS.water_temp_max) {
      return {
        ok: false,
        reason: `Water temp=${currentReading.water_temp.toFixed(1)}°C too high — blocking all dosing`,
      };
    }
    if (currentReading.water_temp < SAFETY_LIMITS.water_temp_min) {
      return {
        ok: false,
        reason: `Water temp=${currentReading.water_temp.toFixed(1)}°C too low — blocking all dosing`,
      };
    }
  }

  // 5. Single-dose limit
  if (command.amount_ml > SAFETY_LIMITS.max_single_dose_ml) {
    return {
      ok: false,
      reason: `Dose ${command.amount_ml}ml exceeds max single dose (${SAFETY_LIMITS.max_single_dose_ml}ml)`,
    };
  }

  // 6. Zero/negative
  if (command.amount_ml <= 0) {
    return { ok: false, reason: `Invalid dose amount: ${command.amount_ml}ml` };
  }

  // Bottle level check — refuse to dose from an empty/near-empty bottle.
  // Critical for preventing the "pump runs forever on an empty channel"
  // failure mode.  We read the live system row (separate from dosing
  // history) since bottle_levels mutates per dose.
  const sys = await getSystem(systemId);
  if (sys?.bottle_levels && typeof sys.bottle_levels[command.channel] === "number") {
    const remaining = sys.bottle_levels[command.channel];
    if (remaining < MIN_BOTTLE_ML_TO_DOSE) {
      return {
        ok: false,
        reason:
          `Bottle for '${command.channel}' is at ${remaining.toFixed(1)}ml — ` +
          `below the ${MIN_BOTTLE_ML_TO_DOSE}ml minimum to dose safely. Refill the bottle and update bottle_levels.`,
      };
    }
    if (remaining < command.amount_ml + MIN_BOTTLE_ML_TO_DOSE / 2) {
      return {
        ok: false,
        reason:
          `Bottle for '${command.channel}' has ${remaining.toFixed(1)}ml; this ${command.amount_ml}ml ` +
          `dose would leave less than the floor (${MIN_BOTTLE_ML_TO_DOSE}ml). Refill before dosing further.`,
      };
    }
  }

  // 7+8. Rate limits — fetch recent successful doses from DB.
  // Priming actions (tube fill, marked by server-set ai_status='priming')
  // don't change the reservoir and are excluded from per-channel interval
  // and per-channel hourly quota.  We DO NOT trust the free-text reason
  // for this exemption anymore — only the server-controlled ai_status
  // column qualifies, so the autonomous brain can't bypass safety by
  // writing reasoning text that happens to read like a prime.
  const recent = await getRecentActions(24, systemId); // 24h for the daily cap
  const isPrimingAction = (a: { ai_status?: string }) => a.ai_status === "priming";

  const sameChannel = recent.filter(
    (a) => a.channel === command.channel && a.success && !isPrimingAction(a)
  );

  // System-wide daily total — extra brake for unverified rigs.  Counts
  // all successful non-priming doses across all channels in the last 24h.
  const dailyTotal = recent
    .filter((a) => a.success && !isPrimingAction(a))
    .reduce((sum, a) => sum + a.amount_ml, 0);
  const dailyCap = sys?.doser_verified
    ? VERIFIED_DAILY_TOTAL_ML
    : PRE_VERIFY_DAILY_TOTAL_ML;
  if (!command.is_priming && dailyTotal + command.amount_ml > dailyCap) {
    return {
      ok: false,
      reason:
        `System-wide 24h cap: already dosed ${dailyTotal.toFixed(1)}ml; this ${command.amount_ml}ml ` +
        `would exceed the ${dailyCap}ml/day cap ` +
        `(${sys?.doser_verified ? "verified" : "pre-verification"} system). ` +
        `Doser protocol must be run + autonomous enabled to raise the cap.`,
    };
  }

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const hourlyTotal = sameChannel
    .filter((a) => a.ts.getTime() > oneHourAgo)
    .reduce((sum, a) => sum + a.amount_ml, 0);

  // Per-channel hourly cap doesn't apply to priming itself either.
  if (
    !command.is_priming &&
    hourlyTotal + command.amount_ml > SAFETY_LIMITS.max_hourly_dose_ml_per_channel
  ) {
    return {
      ok: false,
      reason:
        `Hourly limit: already dosed ${hourlyTotal.toFixed(1)}ml on ${command.channel} ` +
        `(max ${SAFETY_LIMITS.max_hourly_dose_ml_per_channel}ml/hr)`,
    };
  }

  // Min interval — skipped entirely when THIS command is itself a prime.
  if (!command.is_priming && sameChannel.length > 0) {
    const lastDose = sameChannel.reduce((latest, a) =>
      a.ts.getTime() > latest.ts.getTime() ? a : latest
    );
    const elapsed = (Date.now() - lastDose.ts.getTime()) / 1000;
    if (elapsed < SAFETY_LIMITS.min_dose_interval_seconds) {
      return {
        ok: false,
        reason:
          `Too soon: last dose on ${command.channel} was ${elapsed.toFixed(0)}s ago ` +
          `(min ${SAFETY_LIMITS.min_dose_interval_seconds}s)`,
      };
    }
  }

  // 9. pH discipline — pH is a ONCE-A-DAY decision; never fight yourself.
  // Block any pH dose if EITHER pH channel already corrected within the
  // cooldown. This is the hard backstop against the pH-up/pH-down oscillation
  // that emptied a bottle overnight (8 pH-down doses + a simultaneous pH-up
  // seen in production). The prompt asks for restraint; this enforces it.
  if ((isPhUp || isPhDown) && !command.is_priming && !command.ph_override) {
    const roleOf = (ch: string) => cfg.assignments[ch]?.role;
    const phRecent = recent.filter(
      (a) =>
        a.success &&
        !isPrimingAction(a) &&
        (roleOf(a.channel) === "ph_up" || roleOf(a.channel) === "ph_down")
    );
    if (phRecent.length > 0) {
      const last = phRecent.reduce((l, a) =>
        a.ts.getTime() > l.ts.getTime() ? a : l
      );
      const hrs = (Date.now() - last.ts.getTime()) / 3_600_000;
      if (hrs < PH_DECISION_COOLDOWN_HOURS) {
        const lastRole = roleOf(last.channel);
        const opposite =
          (isPhUp && lastRole === "ph_down") || (isPhDown && lastRole === "ph_up");
        return {
          ok: false,
          reason:
            `pH is a once-a-day decision: last pH correction (${last.channel}) was ` +
            `${hrs.toFixed(1)}h ago (min ${PH_DECISION_COOLDOWN_HOURS}h between pH corrections).` +
            (opposite
              ? ` Dosing the OPPOSITE direction now would be fighting yourself — refused.`
              : ` Wait for tomorrow's pH window.`) +
            ` After a real water change the grower can override.`,
        };
      }
    }
  }

  return { ok: true };
}
