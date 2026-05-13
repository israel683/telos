/**
 * AI Decision Cycle — Vercel Cron entry point.
 *
 * Configured in vercel.json to run hourly. Steps:
 *  1. Expire stale human tasks
 *  2. Pull recent readings + actions + pending tasks
 *  3. Call brain (Claude with cached SYSTEM_PROMPT)
 *  4. Persist decision
 *  5. Execute approved doses (each through safety pre-check)
 *  6. Persist any new human tasks
 *  7. Return summary
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

const SYSTEM_PROFILE = {
  system_type: process.env.SYSTEM_TYPE || "nft_wall_mounted",
  reservoir_liters: Number(process.env.RESERVOIR_LITERS || 60),
  crop_type: process.env.CROP_TYPE || "lettuce",
  growth_stage: process.env.GROWTH_STAGE || "vegetative",
  location: process.env.LOCATION || "Tel Aviv, Israel",
  outdoor: true,
};

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();

  try {
    await expireOldTasks();
    const recent = await getRecentReadings(24, 500);
    if (recent.length === 0) {
      return NextResponse.json({
        ok: false,
        skipped: "no readings available yet — poll cron hasn't run or sensor offline",
      });
    }
    const current = recent[recent.length - 1];
    const recentActions = await getRecentActions(24);
    const pendingTasks = await getPendingTasks();

    const decision = await analyzeAndDecide({
      current,
      recent,
      systemProfile: SYSTEM_PROFILE,
      recentActions: recentActions.map((a) => ({
        ts: a.ts,
        channel: a.channel,
        amount_ml: a.amount_ml,
        success: a.success,
        reason: a.reason,
      })),
      pendingTasks,
    });

    const decisionId = await saveDecision({
      status: decision.status,
      analysis: decision.analysis,
      message: decision.message,
      raw_response: decision.raw_response,
      tokens_input: decision.tokens_input,
      tokens_output: decision.tokens_output,
      cache_creation_tokens: decision.cache_creation_tokens,
      cache_read_tokens: decision.cache_read_tokens,
    });

    // Create human tasks
    for (const t of decision.human_tasks) {
      await createHumanTask({
        type: t.type,
        priority: t.priority,
        title: t.title,
        reason: t.reason,
        payload: t.payload,
        expires_in_hours: t.expires_in_hours,
        decision_id: decisionId,
      });
    }

    // Execute approved doses sequentially. Each one ~runtime_seconds long.
    const executed: Array<{ channel: string; amount_ml: number; success: boolean; error?: string }> = [];
    for (const cmd of decision.commands) {
      const r = await doseChannel(cmd.channel, cmd.amount_ml, cmd.reason);
      await saveAction({
        channel: cmd.channel,
        amount_ml: cmd.amount_ml,
        reason: r.success ? cmd.reason : `FAILED: ${r.error}`,
        success: r.success,
        ai_status: decision.status,
        ai_analysis: decision.analysis,
        decision_id: decisionId,
      });
      executed.push({
        channel: cmd.channel,
        amount_ml: cmd.amount_ml,
        success: r.success,
        error: r.error,
      });
    }

    return NextResponse.json({
      ok: true,
      decision_id: decisionId,
      status: decision.status,
      message: decision.message,
      commands_executed: executed,
      blocked: decision.blocked_commands,
      tasks_created: decision.human_tasks.length,
      next_check_minutes: decision.next_check_minutes,
      duration_ms: Date.now() - started,
      tokens: {
        input: decision.tokens_input,
        output: decision.tokens_output,
        cache_create: decision.cache_creation_tokens,
        cache_read: decision.cache_read_tokens,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/cycle] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
