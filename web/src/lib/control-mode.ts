/**
 * Execution posture — the single source of truth for whether the Brain may FIRE
 * pumps on a cycle, derived from the grower's control_mode + the safety state.
 *
 * THE INVARIANT (never break): control_mode is a SUBTRACT-ONLY gate term. It can
 * route every recommendation into a task, but it can NEVER enable dosing.
 * Autonomy requires ALL of: brain_doser intent AND the master toggle
 * (autonomous_dosing_enabled) AND a verified doser (doser_verified) — each
 * independently true. hybrid is deferred → treated as `advise` until its safety
 * envelope is built.
 */

import type { GrowProfile } from "./grow-profile";

export type ExecutionPosture = "autonomous" | "advise";
export type ControlMode = NonNullable<GrowProfile["control_mode"]>; // advisor_only | brain_doser | hybrid

type PostureInput = {
  autonomous_dosing_enabled: boolean;
  doser_verified: boolean;
  grow_profile: GrowProfile | null;
};

/**
 * The grow's control_mode, with a safe backfill for systems onboarded before the
 * field existed: an already-autonomous system reads as brain_doser; otherwise
 * advisor_only (the safe posture). This makes the field's introduction a day-one
 * no-op while letting onboarding set it explicitly going forward.
 */
export function effectiveControlMode(sys: Pick<PostureInput, "autonomous_dosing_enabled" | "grow_profile">): ControlMode {
  return sys.grow_profile?.control_mode ?? (sys.autonomous_dosing_enabled ? "brain_doser" : "advisor_only");
}

/** Whether the Brain may fire pumps this cycle. `advise` ⇒ recommendations become tasks. */
export function resolveExecutionPosture(sys: PostureInput): ExecutionPosture {
  const mode = effectiveControlMode(sys);
  const autonomousAllowed =
    mode === "brain_doser" && sys.autonomous_dosing_enabled === true && sys.doser_verified === true;
  return autonomousAllowed ? "autonomous" : "advise";
}
