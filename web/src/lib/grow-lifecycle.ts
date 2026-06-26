/**
 * Grow lifecycle — the state machine a grow moves through, and the one missing
 * piece that turns a recorded HARVEST into an actual lifecycle TRANSITION.
 *
 * The bug this closes: before this module a grow had no terminal state on the
 * harvest path. `systems.status` is active|paused|archived, the autonomous cron
 * runs every `active` system (`/api/cron/cycle` → `listSystems().filter(active)`),
 * and NOTHING on the harvest path ever flipped the status. So when the grower
 * said "I did the final harvest" in chat, the system stayed `active` and the
 * Brain kept polling, deciding and nagging an already-finished grow.
 *
 * `recordHarvest` (lib/agent-tools.ts) now consumes this: a terminal harvest
 * archives the system (stops the loop) and a recurring harvest rolls the next
 * date forward. See NEXTGEN-ARCHITECTURE-V2.md §"Grow lifecycle".
 *
 * Pure + dependency-free so it's trivially testable and safe on client/server.
 */

export type HarvestMode = "cut_and_come_again" | "repeated_pick" | "single_terminal";

/**
 * The lifecycle phases a grow passes through. `status` (active/paused/archived)
 * stays the coarse DB flag the cron filters on; `phase` is the agronomic state
 * the Brain reasons about. `closed` maps to `status='archived'`.
 */
export type GrowPhase =
  | "onboarding" // profile being built; setup not confirmed
  | "establishing" // setup confirmed, early/seedling
  | "growing" // the steady productive run
  | "harvest_window" // at/near the planned harvest
  | "closed"; // terminal harvest done — archived, loop off

/**
 * What recording a harvest should DO to the grow.
 *  - `close`    → terminal: archive the system, stop the autonomous loop.
 *  - `continue` → the plant lives on; roll the next harvest date forward.
 */
export type HarvestOutcome =
  | { kind: "close"; reason: string }
  | { kind: "continue"; next_date: string; reason: string };

/** Default cadence (days) for a recurring harvest when the cultivar has none. */
export const DEFAULT_HARVEST_CADENCE_DAYS = 7;

/**
 * Decide whether a recorded harvest CLOSES the grow or CONTINUES it.
 *
 * A grow closes when the grower marks this the FINAL harvest, OR the cultivar's
 * harvest mode is `single_terminal` (one reaping retires the plant — head
 * lettuce, radicchio, mâche). Otherwise it is a cut-and-come-again / repeated
 * pick: the plant keeps producing and the next harvest rolls forward by the
 * cultivar cadence (falling back to a weekly default).
 */
export function resolveHarvestOutcome(opts: {
  mode: HarvestMode | string | null | undefined;
  isFinal: boolean;
  cadenceDays: number | null | undefined;
  /** Reckon the next date from here (defaults to now). */
  from?: Date;
}): HarvestOutcome {
  const terminal = opts.isFinal || opts.mode === "single_terminal";
  if (terminal) {
    return {
      kind: "close",
      reason: opts.isFinal ? "grower marked final harvest" : "single_terminal cultivar — one harvest retires the plant",
    };
  }
  const cadence = opts.cadenceDays && opts.cadenceDays > 0 ? opts.cadenceDays : DEFAULT_HARVEST_CADENCE_DAYS;
  const from = opts.from ?? new Date();
  const next = new Date(from.getTime() + cadence * 24 * 60 * 60 * 1000);
  return {
    kind: "continue",
    next_date: next.toISOString().slice(0, 10),
    reason: `cut-and-come-again — next harvest in ~${cadence}d`,
  };
}

/**
 * Derive the agronomic lifecycle phase of a grow from its coarse DB fields. Pure
 * — used by the admin architecture surface (and reusable by the Brain). `status`
 * stays the DB flag the cron filters on; this maps it (plus setup + harvest) onto
 * the GrowPhase the system reasons about.
 */
export function deriveGrowPhase(g: {
  status?: string | null;
  setup_completed_at?: Date | string | null;
  growth_stage?: string | null;
  harvest_plan?: { next_date?: string | null; completed_at?: string | null; prep_lead_days?: number } | null;
  now?: Date;
}): GrowPhase {
  if (g.status === "archived" || g.harvest_plan?.completed_at) return "closed";
  if (!g.setup_completed_at) return "onboarding";
  const hp = g.harvest_plan;
  if (hp?.next_date) {
    const now = (g.now ?? new Date()).getTime();
    const target = new Date(`${hp.next_date}T00:00:00Z`).getTime();
    if (Number.isFinite(target)) {
      const leadMs = Math.max(hp.prep_lead_days ?? 1, 2) * 24 * 60 * 60 * 1000;
      if (now >= target - leadMs) return "harvest_window";
    }
  }
  if (g.growth_stage === "seedling") return "establishing";
  return "growing";
}

