/**
 * Dose executor — the ONE safety-gated primitive that fires a treatment dose.
 *
 * Before this, "fire a dose" lived in THREE divergent copies: the chat tool
 * (executeDose), the autonomous cron loop (cycle.ts), and the dashboard approval
 * route (/api/tasks/:id/approve). They drifted — the approve copy forgot to
 * decrement the bottle, corrupting the safety floor + forecast. This is the
 * shared action layer from NEXTGEN-ARCHITECTURE-V2.md §2.1: one place that
 * resolves the physical channel, runs the SafetyController, fires the pump, logs
 * the action, and decrements the bottle. Every caller — chat, cron, approval —
 * goes through here, so the safety + bookkeeping can never diverge again.
 */
import {
  getRecentReadings,
  saveAction,
  decrementBottle,
  type WaterReading,
} from "./db";
import { validateCommand } from "./safety";
import { doseChannelByPhysical } from "./devices/jebao";
import { getDosingConfig, type DosingConfig } from "./dosing-config";

export type DoseExecRequest = {
  /** Logical channel key (resolved to a physical Jebao channel via dosing_config). */
  channel: string;
  amount_ml: number;
  /** Grower-facing reason logged on success (the failure row records the error). */
  reason: string;
  /** ai_status tag for the dosing_actions row: 'chat' | 'approved' | the cycle status… */
  aiStatus: string;
  /** Optional ai_analysis note for the row. */
  aiAnalysis?: string;
  /** Link the action to the decision that produced it (cron path). */
  decisionId?: number;
};

export type DoseExecResult = {
  /** True only when the pump fired successfully. */
  ok: boolean;
  /** No physical channel is mapped for this key — caller decides (e.g. manual dose). */
  noPhysicalChannel?: boolean;
  /** The SafetyController refused the dose; `reason` carries why. */
  blockedBySafety?: boolean;
  reason?: string;
  physicalChannel?: number;
  runtimeSeconds?: number;
  error?: string;
};

/**
 * Validate → fire → log → decrement, atomically from the caller's view.
 * Never throws on the dosing path; returns a structured result the caller adapts
 * to its own response shape.
 */
export async function executeDoseGated(
  systemId: string,
  req: DoseExecRequest,
  opts: {
    /** Latest reading for the safety check; fetched if omitted. */
    current?: WaterReading | null;
    /** Per-system dosing config; fetched if omitted. */
    dosingConfig?: DosingConfig;
    /** Decrement the bottle on success (default true). Priming handles its own. */
    decrement?: boolean;
  } = {}
): Promise<DoseExecResult> {
  const dosingConfig = opts.dosingConfig ?? (await getDosingConfig(systemId));
  const assignment = dosingConfig.assignments[req.channel];
  if (!assignment) {
    return { ok: false, noPhysicalChannel: true, error: `no physical channel mapped for '${req.channel}'` };
  }

  // Safety gate — against the freshest reading we have.
  const current =
    opts.current !== undefined
      ? opts.current
      : (await getRecentReadings(1, 1, systemId)).slice(-1)[0] ?? null;
  const safety = await validateCommand(
    { channel: req.channel, amount_ml: req.amount_ml, reason: req.reason, is_priming: false },
    current,
    { systemId, dosingConfig }
  );
  if (!safety.ok) {
    return { ok: false, blockedBySafety: true, reason: safety.reason, physicalChannel: assignment.physical };
  }

  // Fire the pump.
  const r = await doseChannelByPhysical(assignment.physical, req.amount_ml, req.reason, req.channel);

  // Log either way so the audit trail stays honest.
  try {
    await saveAction(
      {
        channel: req.channel,
        amount_ml: req.amount_ml,
        reason: r.success ? req.reason : `FAILED: ${req.reason} (${r.error})`,
        success: r.success,
        ai_status: req.aiStatus,
        ai_analysis: req.aiAnalysis,
        decision_id: req.decisionId,
      },
      systemId
    );
  } catch (e) {
    console.error("[dose-executor] saveAction failed:", e);
  }

  // Bottle bookkeeping on confirmed success.
  if (r.success && opts.decrement !== false) {
    try {
      await decrementBottle(systemId, req.channel, req.amount_ml);
    } catch (e) {
      console.error("[dose-executor] decrementBottle failed:", e);
    }
  }

  return {
    ok: r.success,
    physicalChannel: assignment.physical,
    runtimeSeconds: r.runtime_seconds,
    error: r.error,
  };
}
