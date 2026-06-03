/**
 * Daily report cron — generates a Hebrew summary of the past 24h for each
 * active system and pushes it into the chat thread.
 *
 * Configured via vercel.json (default: 08:00 daily). Skips paused/archived
 * systems.
 */
import { NextResponse } from "next/server";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import {
  listSystems,
  getRecentReadings,
  getRecentDecisions,
  getRecentActions,
  getPendingTasks,
  saveChatMessage,
} from "@/lib/db";
// Brand voice imported from the canonical reference — same rules apply
// to the daily report as to the chat agent and the autonomous brain.
import { TELOS_VOICE_PROMPT } from "@/brand/voice";
import { sendAlertEmail } from "@/lib/notify";

export const maxDuration = 60;

const anthropic = createAnthropic({
  apiKey: process.env.GROWK_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: "https://api.anthropic.com/v1",
});

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (req.headers.get("x-vercel-cron")) return true;
  return false;
}

const REPORT_PROMPT = TELOS_VOICE_PROMPT + `

# Daily report — your task

You are TELOS, the agronomist. Write a short DAILY REPORT in Hebrew for the grower covering the past 24 hours.

Style:
- 3–5 short paragraphs OR a brief bullet list. Markdown allowed.
- Open with one summary sentence ("היום היה יום יציב/לב/קשה...").
- Mention: how many sensor readings came in, key trends (pH/EC/temp drift), any dosing actions taken or blocked, any pending human tasks, and 1–2 concerns for the next 24h.
- End with a brief forward-look ("מה לצפות מחר").
- No JSON. Plain Hebrew prose. Concise (≤180 words).

You will receive raw stats. Convert to natural Hebrew narrative.`;

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
        const [readings, decisions, actions, tasks] = await Promise.all([
          getRecentReadings(24, 500, sys.id),
          getRecentDecisions(20, sys.id),
          getRecentActions(24, sys.id),
          getPendingTasks(sys.id),
        ]);

        if (readings.length === 0 && decisions.length === 0) {
          results.push({ system_id: sys.id, skipped: "no activity in 24h" });
          continue;
        }

        // Compute compact stats for the prompt
        const phVals = readings.map((r) => r.ph).filter((v): v is number => v !== null);
        const ecVals = readings.map((r) => r.ec).filter((v): v is number => v !== null);
        const tempVals = readings.map((r) => r.water_temp).filter((v): v is number => v !== null);
        const stats = {
          readings_count: readings.length,
          ph: phVals.length
            ? {
                min: Math.min(...phVals).toFixed(2),
                max: Math.max(...phVals).toFixed(2),
                avg: (phVals.reduce((s, v) => s + v, 0) / phVals.length).toFixed(2),
              }
            : null,
          ec: ecVals.length
            ? {
                min: Math.min(...ecVals).toFixed(0),
                max: Math.max(...ecVals).toFixed(0),
                avg: (ecVals.reduce((s, v) => s + v, 0) / ecVals.length).toFixed(0),
              }
            : null,
          water_temp: tempVals.length
            ? {
                min: Math.min(...tempVals).toFixed(1),
                max: Math.max(...tempVals).toFixed(1),
                avg: (tempVals.reduce((s, v) => s + v, 0) / tempVals.length).toFixed(1),
              }
            : null,
          decisions: decisions.map((d) => ({ status: d.status, message: d.message.slice(0, 120) })),
          actions: actions.map((a) => ({
            channel: a.channel,
            amount_ml: a.amount_ml,
            success: a.success,
          })),
          pending_task_count: tasks.length,
        };

        const userMsg = `## ${sys.name} (${sys.crop_type}, ${sys.reservoir_liters}L, ${sys.location})

Stats from last 24h:
${JSON.stringify(stats, null, 2)}`;

        const ai = await generateText({
          model: anthropic(process.env.CHAT_MODEL || "claude-sonnet-4-6"),
          maxOutputTokens: 600,
          system: REPORT_PROMPT,
          prompt: userMsg,
        });

        await saveChatMessage({
          systemId: sys.id,
          role: "assistant",
          parts: [{ type: "text", text: `📅 **דוח יומי**\n\n${ai.text}` }],
          source: "cron-cycle",
          status: "healthy",
        });

        // Also deliver the digest out-of-app (email). No-op unless configured.
        const mail = await sendAlertEmail(`TELOS · דוח יומי — ${sys.name}`, ai.text);

        results.push({
          system_id: sys.id,
          ok: true,
          readings_count: readings.length,
          decisions_count: decisions.length,
          emailed: mail.ok,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[daily-report] system=${sys.id} error:`, msg);
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
    console.error("[daily-report] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg, results }, { status: 500 });
  }
}
