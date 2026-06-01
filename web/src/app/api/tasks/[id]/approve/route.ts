/**
 * POST /api/tasks/:id/approve — used by the dashboard "אשר ובצע" button on
 * `dose_approval` tasks.  Reads the task's payload (channel + amount_ml),
 * validates against the SafetyController, fires the pump, logs to
 * dosing_actions, and marks the task as done.
 *
 * This is the missing link from the old flow where clicking "בוצע" on a
 * dose_approval card just marked the task done without actually running
 * the pump.  The dashboard now distinguishes between the two task
 * categories: approval-needed (this endpoint) and hands-needed
 * (completeTask endpoint, untouched).
 */
import { NextResponse } from "next/server";
import { completeTask, saveAction, sql, ensureSchema } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";
import { getDosingConfig } from "@/lib/dosing-config";
import { doseChannelByPhysical } from "@/lib/devices/jebao";
import { validateCommand } from "@/lib/safety";
import { getRecentReadings } from "@/lib/db";

export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const systemId = systemIdFromRequest(req);
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // Pull the task to extract its payload.
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, system_id, type, payload, status
    FROM human_tasks
    WHERE id = ${taskId} AND system_id = ${systemId}
  `) as unknown as Array<{
    id: number;
    system_id: string;
    type: string;
    payload: Record<string, unknown> | null;
    status: string;
  }>;
  const task = rows[0];
  if (!task) {
    return NextResponse.json({ error: "task not found for this system" }, { status: 404 });
  }
  if (task.status !== "pending") {
    return NextResponse.json(
      { error: `task is already ${task.status}` },
      { status: 409 }
    );
  }
  if (task.type !== "dose_approval") {
    return NextResponse.json(
      { error: `task type '${task.type}' is not approvable; use /complete instead` },
      { status: 400 }
    );
  }
  const payload = task.payload ?? {};
  const channel = String(payload.channel || "").trim();
  const amountMl = Number(payload.amount_ml);
  if (!channel || !Number.isFinite(amountMl) || amountMl <= 0) {
    return NextResponse.json(
      { error: "task payload missing channel / amount_ml", payload },
      { status: 400 }
    );
  }

  // Resolve channel to physical via the system's dosing_config.
  const cfg = await getDosingConfig(systemId);
  const assignment = cfg.assignments[channel];
  if (!assignment) {
    // No physical doser channel maps to this input — dosing for it is MANUAL
    // (e.g. a single-bottle nutrient added by hand). The dose_approval is a
    // recommendation the grower performs themselves, so "approve" here means
    // "I did it": record a manual dose (keeps the audit + EC history honest and
    // stops the brain re-recommending immediately) and mark the task done.
    // There is no pump to fire.
    try {
      await saveAction(
        {
          channel,
          amount_ml: amountMl,
          reason: `manual dose confirmed via dashboard (task #${taskId}) — no doser channel for '${channel}'`,
          success: true,
          ai_status: "manual",
          ai_analysis: `Grower confirmed a manual dose from dashboard task #${taskId}`,
        },
        systemId
      );
    } catch (e) {
      console.error("[task/approve] failed to log manual action:", e);
    }
    try {
      await completeTask(taskId, "confirmed done (manual dose)", systemId);
    } catch (e) {
      console.error("[task/approve] failed to complete manual task:", e);
    }
    return NextResponse.json({
      ok: true,
      task_id: taskId,
      channel,
      amount_ml: amountMl,
      manual: true,
      note: `No doser channel for '${channel}' on this system — recorded as a manual dose and marked done (no pump fired).`,
    });
  }

  // Safety check against the latest reading.
  const recent = await getRecentReadings(1, 1, systemId);
  const current = recent[recent.length - 1] ?? null;
  const safety = await validateCommand(
    { channel, amount_ml: amountMl, reason: "dose_approval task" },
    current,
    { systemId, dosingConfig: cfg }
  );
  if (!safety.ok) {
    return NextResponse.json(
      { ok: false, blocked_by_safety: true, reason: safety.reason },
      { status: 422 }
    );
  }

  // Fire the pump.
  const r = await doseChannelByPhysical(
    assignment.physical,
    amountMl,
    `approved dose_approval #${taskId}`,
    channel
  );

  // Log + complete the task regardless of pump success, so the audit
  // trail captures the attempt and the task doesn't stay "pending forever".
  try {
    await saveAction(
      {
        channel,
        amount_ml: amountMl,
        reason: r.success
          ? `approved via dashboard (task #${taskId})`
          : `FAILED approved dose (task #${taskId}): ${r.error}`,
        success: r.success,
        ai_status: "approved",
        ai_analysis: `Dose approved by grower from dashboard task #${taskId}`,
      },
      systemId
    );
  } catch (e) {
    console.error("[task/approve] failed to log action:", e);
  }
  try {
    await completeTask(taskId, r.success ? "approved + executed" : `approved but failed: ${r.error}`, systemId);
  } catch (e) {
    console.error("[task/approve] failed to mark task complete:", e);
  }

  return NextResponse.json({
    ok: r.success,
    task_id: taskId,
    channel,
    physical_channel: assignment.physical,
    amount_ml: amountMl,
    runtime_seconds: r.runtime_seconds,
    error: r.error,
  });
}
