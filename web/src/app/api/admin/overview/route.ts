/**
 * GET /api/admin/overview — admin-only live "system pulse" for the architecture
 * surface. Surfaces the state the V2 work produced: each grow's lifecycle phase
 * + its last decision (tier, source, trigger), and a tier tally — including the
 * internal-only fields (`tier`) that the customer-facing /api/decisions hides.
 */
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { listSystems, getRecentDecisions } from "@/lib/db";
import { deriveGrowPhase } from "@/lib/grow-lifecycle";

export const maxDuration = 15;

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const systems = await listSystems();
    const tierTally: Record<string, number> = { light: 0, heavy: 0, unknown: 0 };

    const rows = await Promise.all(
      systems.map(async (sys) => {
        const decisions = await getRecentDecisions(30, sys.id);
        for (const d of decisions) {
          const k = d.tier === "light" || d.tier === "heavy" ? d.tier : "unknown";
          tierTally[k] += 1;
        }
        const last = decisions[0] ?? null;
        const inputs = (last?.inputs ?? null) as { trigger?: string } | null;
        const phase = deriveGrowPhase({
          status: sys.status,
          setup_completed_at: sys.setup_completed_at,
          growth_stage: sys.growth_stage,
          harvest_plan: sys.grow_profile?.harvest_plan ?? null,
        });
        return {
          id: sys.id,
          name: sys.name,
          status: sys.status,
          phase,
          crop: sys.cultivar_id || sys.crop_type,
          stage: sys.growth_stage,
          autonomous: sys.autonomous_dosing_enabled,
          next_check_at: sys.next_check_at ? sys.next_check_at.toISOString() : null,
          last_decision: last
            ? {
                id: last.id,
                ts: last.ts.toISOString(),
                status: last.status,
                tier: last.tier ?? null,
                source: last.decision_source ?? null,
                trigger: inputs?.trigger ?? null,
              }
            : null,
        };
      })
    );

    return NextResponse.json({ systems: rows, tier_tally: tierTally });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
