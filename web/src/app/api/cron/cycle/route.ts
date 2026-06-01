/**
 * AI decision cycle cron — iterates over all active systems.
 *
 * The per-system work (gate → brain → persist decision → execute/queue doses →
 * episode → chat push) lives in `runSystemCycle` (lib/cycle.ts) so that the
 * EXACT same re-derivation path is also reachable from grower actions (a
 * confirmed dose, an answered question) — that shared path is how every
 * surface stays in sync instead of showing a 2-hour-old snapshot.
 *
 * Runtime caveat: dose execution sleeps for the dose duration; with multiple
 * systems each running multiple doses, total wall time could exceed the 60s
 * Vercel Pro Plus limit. For Phase 1 (single active system), well within budget.
 * When we hit it, fan out via Vercel Queue.
 */
import { NextResponse } from "next/server";
import { listSystems } from "@/lib/db";
import { runSystemCycle } from "@/lib/cycle";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (req.headers.get("x-vercel-cron")) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const results: Array<Record<string, unknown>> = [];

  try {
    const systems = (await listSystems()).filter((s) => s.status === "active");

    for (const sys of systems) {
      try {
        results.push(await runSystemCycle(sys, { source: "cron" }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[cron/cycle] system=${sys.id} error:`, msg);
        results.push({ system_id: sys.id, ok: false, error: msg });
      }
    }

    return NextResponse.json({
      ok: true,
      systems_processed: results.length,
      results,
      duration_ms: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/cycle] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg, results }, { status: 500 });
  }
}
