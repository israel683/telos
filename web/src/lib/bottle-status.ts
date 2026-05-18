/**
 * Bottle status computation — combines stored levels with the dosing
 * history to produce a per-channel snapshot the brain and UI can both
 * consume.
 *
 * Per-channel snapshot:
 *  - capacity_ml: original/full volume (from bottle_capacities)
 *  - remaining_ml: current tracked remaining (from bottle_levels)
 *  - percent_remaining: remaining / capacity * 100, when capacity > 0
 *  - consumed_7d_ml: total successful non-priming doses over the last 7d
 *  - daily_avg_ml: consumed_7d / actual days observed
 *  - days_until_empty: remaining / daily_avg (null when no consumption yet)
 *  - level: "ok" | "low" | "near_empty" | "empty" | "unknown"
 *  - verified_at: last time the grower visually confirmed this channel
 *  - needs_recheck: true if no verification in 7+ days
 */
import { getRecentActions, getSystem } from "./db";

export const LEVEL_THRESHOLDS = {
  near_empty_ml: 15,    // matches safety floor
  low_pct: 25,          // %remaining below this → "low"
  recheck_days: 7,
};

export type ChannelBottleStatus = {
  channel: string;
  capacity_ml: number | null;
  remaining_ml: number | null;
  percent_remaining: number | null;
  consumed_7d_ml: number;
  daily_avg_ml: number | null;
  days_until_empty: number | null;
  level: "ok" | "low" | "near_empty" | "empty" | "unknown";
  verified_at: string | null;
  needs_recheck: boolean;
};

export async function getBottleStatusReport(systemId: string): Promise<{
  channels: ChannelBottleStatus[];
  any_near_empty: boolean;
  any_needs_recheck: boolean;
}> {
  const sys = await getSystem(systemId);
  if (!sys) return { channels: [], any_near_empty: false, any_needs_recheck: false };

  const levels = sys.bottle_levels ?? {};
  const capacities = sys.bottle_capacities ?? {};
  const verifiedAt = sys.bottle_verified_at ?? {};
  // Last 7 days of actions for consumption rate.
  const actions = await getRecentActions(24 * 7, systemId);

  // Bucket consumption per channel.  Exclude priming + failed.
  const consumedByChannel: Record<string, number> = {};
  let earliestTs = Number.POSITIVE_INFINITY;
  for (const a of actions) {
    if (!a.success) continue;
    if (a.ai_status === "priming") continue;
    if (a.ai_status === "doser_protocol") continue;
    consumedByChannel[a.channel] = (consumedByChannel[a.channel] ?? 0) + a.amount_ml;
    if (a.ts.getTime() < earliestTs) earliestTs = a.ts.getTime();
  }
  const observedSpanDays = Number.isFinite(earliestTs)
    ? Math.max(1, (Date.now() - earliestTs) / (24 * 3600 * 1000))
    : 0;

  // Cover the union of channels we know about (have either capacity OR level OR consumption).
  const keys = new Set<string>([
    ...Object.keys(levels),
    ...Object.keys(capacities),
    ...Object.keys(consumedByChannel),
  ]);

  const channels: ChannelBottleStatus[] = [];
  for (const key of keys) {
    const cap = capacities[key] ?? null;
    const rem = levels[key] ?? null;
    const pct = cap && cap > 0 && rem !== null ? (rem / cap) * 100 : null;
    const consumed7 = consumedByChannel[key] ?? 0;
    const dailyAvg = observedSpanDays > 0 && consumed7 > 0 ? consumed7 / observedSpanDays : null;
    const daysUntilEmpty =
      dailyAvg !== null && rem !== null && dailyAvg > 0 ? rem / dailyAvg : null;
    const verified = verifiedAt[key] ?? null;
    const ageDays = verified ? (Date.now() - new Date(verified).getTime()) / (24 * 3600 * 1000) : Infinity;
    const needsRecheck = ageDays > LEVEL_THRESHOLDS.recheck_days;

    let level: ChannelBottleStatus["level"];
    if (rem === null) level = "unknown";
    else if (rem <= 0) level = "empty";
    else if (rem < LEVEL_THRESHOLDS.near_empty_ml) level = "near_empty";
    else if (pct !== null && pct < LEVEL_THRESHOLDS.low_pct) level = "low";
    else level = "ok";

    channels.push({
      channel: key,
      capacity_ml: cap,
      remaining_ml: rem,
      percent_remaining: pct,
      consumed_7d_ml: consumed7,
      daily_avg_ml: dailyAvg,
      days_until_empty: daysUntilEmpty,
      level,
      verified_at: verified,
      needs_recheck: needsRecheck,
    });
  }

  return {
    channels,
    any_near_empty: channels.some((c) => c.level === "near_empty" || c.level === "empty"),
    any_needs_recheck: channels.some((c) => c.needs_recheck && c.remaining_ml !== null),
  };
}
