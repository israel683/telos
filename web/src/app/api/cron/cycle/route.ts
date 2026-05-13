/**
 * AI decision cycle cron — iterates over all active systems.
 *
 * For each active system:
 *  1. Expire stale human tasks (per-system)
 *  2. Pull recent readings + actions + pending tasks (per-system)
 *  3. Call brain (Claude with cached SYSTEM_PROMPT)
 *  4. Persist decision (per-system)
 *  5. Execute approved doses (sequentially)
 *  6. Persist any new human tasks
 *
 * Runtime caveat: dose execution sleeps for the dose duration; with multiple
 * systems each running multiple doses, total wall time could exceed the 60s
 * Vercel Pro Plus limit. For Phase 1 (single active system), well within budget.
 * When we hit it, fan out via Vercel Queue.
 */
import { NextResponse } from "next/server";
import {
  getRecentReadings,
  getRecentActions,
  getPendingTasks,
  saveDecision,
  saveAction,
  createHumanTask,
  expireOldTasks,
  listSystems,
  saveChatMessage,
} from "@/lib/db";
import { analyzeAndDecide } from "@/lib/brain";
import { doseChannel } from "@/lib/devices/jebao";

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
      const sysStart = Date.now();
      try {
        await expireOldTasks(sys.id);
        const recent = await getRecentReadings(24, 500, sys.id);
        if (recent.length === 0) {
          results.push({
            system_id: sys.id,
            ok: false,
            skipped: "no readings yet",
          });
          continue;
        }
        const current = recent[recent.length - 1];
        const recentActions = await getRecentActions(24, sys.id);
        const pendingTasks = await getPendingTasks(sys.id);

        const decision = await analyzeAndDecide({
          current,
          recent,
          systemProfile: {
            system_type: sys.system_type,
            reservoir_liters: sys.reservoir_liters,
            crop_type: sys.crop_type,
            growth_stage: sys.growth_stage,
            location: sys.location,
            outdoor: sys.outdoor,
          },
          recentActions: recentActions.map((a) => ({
            ts: a.ts,
            channel: a.channel,
            amount_ml: a.amount_ml,
            success: a.success,
            reason: a.reason,
          })),
          pendingTasks,
        });

        const decisionId = await saveDecision(
          {
            status: decision.status,
            analysis: decision.analysis,
            message: decision.message,
            raw_response: decision.raw_response,
            tokens_input: decision.tokens_input,
            tokens_output: decision.tokens_output,
            cache_creation_tokens: decision.cache_creation_tokens,
            cache_read_tokens: decision.cache_read_tokens,
          },
          sys.id
        );

        for (const t of decision.human_tasks) {
          await createHumanTask(
            {
              type: t.type,
              priority: t.priority,
              title: t.title,
              reason: t.reason,
              payload: t.payload,
              expires_in_hours: t.expires_in_hours,
              decision_id: decisionId,
            },
            sys.id
          );
        }

        const executed: Array<{ channel: string; amount_ml: number; success: boolean; error?: string }> = [];
        for (const cmd of decision.commands) {
          const r = await doseChannel(cmd.channel, cmd.amount_ml, cmd.reason);
          await saveAction(
            {
              channel: cmd.channel,
              amount_ml: cmd.amount_ml,
              reason: r.success ? cmd.reason : `FAILED: ${r.error}`,
              success: r.success,
              ai_status: decision.status,
              ai_analysis: decision.analysis,
              decision_id: decisionId,
            },
            sys.id
          );
          executed.push({
            channel: cmd.channel,
            amount_ml: cmd.amount_ml,
            success: r.success,
            error: r.error,
          });
        }

        // Push a chat message so the grower sees this cycle in their thread
        // next time they open the conversation. The UI renders these as
        // collapsible log cards — full reasoning + actions hidden by default.
        try {
          await saveChatMessage({
            systemId: sys.id,
            role: "assistant",
            parts: [
              {
                type: "text",
                text: decision.message || decision.analysis || "מחזור ניתוח אוטומטי הסתיים.",
              },
            ],
            source: "cron-cycle",
            decisionId,
            status: decision.status,
          });
        } catch (e) {
          console.error("[cron/cycle] failed to push chat message:", e);
        }

        results.push({
          system_id: sys.id,
          ok: true,
          decision_id: decisionId,
          status: decision.status,
          commands_executed: executed,
          blocked: decision.blocked_commands,
          tasks_created: decision.human_tasks.length,
          next_check_minutes: decision.next_check_minutes,
          tokens: {
            input: decision.tokens_input,
            output: decision.tokens_output,
            cache_create: decision.cache_creation_tokens,
            cache_read: decision.cache_read_tokens,
          },
          duration_ms: Date.now() - sysStart,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[cron/cycle] system=${sys.id} error:`, msg);
        results.push({
          system_id: sys.id,
          ok: false,
          error: msg,
          duration_ms: Date.now() - sysStart,
        });
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
