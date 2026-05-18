/**
 * Per-channel feed-tube priming.
 *
 * Every doser channel has a physical feed tube between the bottle and the
 * reservoir.  On a fresh install (or after a bottle swap) that tube is full
 * of air; the FIRST dose just pushes liquid into the tube and never reaches
 * the reservoir.  Measured dead volume on this rig is ~8 ml per channel.
 *
 * Implications for the autonomous brain:
 *   - The first dose on an unprimed channel changes NOTHING in the reservoir
 *     (no EC bump, no pH shift) — don't reason about it as if it did.
 *   - Priming must complete BEFORE the agent uses dose-vs-EC observations
 *     to calibrate ml-per-50μS/cm.
 *   - When the grower swaps a bottle / refills a tube, the channel returns
 *     to "unprimed" until re-primed.
 *
 * Storage: priming state is derived from the dosing_actions log — a channel
 * is considered primed iff there's a successful dose on it tagged with the
 * sentinel reason "priming:done".  No schema change; this lets the grower
 * tell us "I just swapped Bottle 2" by clearing the priming marker via a
 * follow-up "unprime" entry (a manual action), and the agent picks it up
 * from the log on the next cycle.
 */
import { getRecentActions } from "./db";

/** ml of dead volume in each channel's feed tube on this rig. */
export const PRIMING_ML_PER_CHANNEL = 8;

/** Reason sentinel written to dosing_actions when a priming run completes. */
export const PRIMING_DONE_SENTINEL = "priming:done";

/** Reason sentinel for an explicit grower-triggered "this tube is empty again". */
export const PRIMING_RESET_SENTINEL = "priming:reset";

export type PrimingState = {
  /** channel key → status entry */
  channels: Record<
    string,
    {
      primed: boolean;
      /** Most recent priming-related action timestamp, if any. */
      last_event_at: Date | null;
      /** Total ml dosed on this channel since the last priming event. */
      ml_since_last_event: number;
    }
  >;
};

/**
 * Inspect the dosing-actions log to compute current priming state per
 * channel.  Looks back far enough to catch the original prime even on
 * long-running systems.
 *
 * Detection is by SERVER-CONTROLLED ai_status='priming' — NOT by free-text
 * `reason`.  After the v0.3 audit, the reason-prefix path was abused by
 * the autonomous brain (it wrote English-prose reasons that happened to
 * read like priming, slipping past the priming-state check).  ai_status
 * is set by the priming tools server-side and is not influenced by
 * Claude's prose output.
 */
export async function getPrimingState(systemId: string): Promise<PrimingState> {
  // 90 days is generous — covers the longest realistic gap between bottle
  // swaps.  All entries are scanned chronologically.
  const actions = await getRecentActions(24 * 90, systemId);

  const channels: PrimingState["channels"] = {};
  for (const a of actions) {
    const key = a.channel;
    if (!channels[key]) {
      channels[key] = { primed: false, last_event_at: null, ml_since_last_event: 0 };
    }
    const reason = a.reason || "";
    if (a.ai_status === "priming" && a.success) {
      channels[key] = {
        primed: true,
        last_event_at: a.ts,
        ml_since_last_event: 0,
      };
    } else if (reason.startsWith(PRIMING_RESET_SENTINEL)) {
      // Explicit "this tube was emptied, re-prime needed" sentinel from
      // the grower.  Still a reason-prefix because it's a deliberate
      // grower-driven event, not LLM output.
      channels[key] = {
        primed: false,
        last_event_at: a.ts,
        ml_since_last_event: 0,
      };
    } else if (a.success) {
      channels[key].ml_since_last_event += a.amount_ml;
    }
  }
  return { channels };
}

/** Convenience: which channel keys are still unprimed? */
export function unprimedChannels(state: PrimingState, allKeys: string[]): string[] {
  return allKeys.filter((k) => !state.channels[k]?.primed);
}
