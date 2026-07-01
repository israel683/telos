/**
 * POST /api/tasks/:id/answer — answer a `question` task with free text.
 * Stores the answer, completes the task, and feeds it into Grower Memory so the
 * Brain uses it. Body: { answer: string }.
 */
import { NextResponse } from "next/server";
import { answerTask } from "@/lib/db";
import { reevalSystem } from "@/lib/cycle";
import { systemIdFromRequest } from "@/lib/system-ctx";

// 60s, not 30: the post-save reevalSystem runs a full Brain call (itself up to
// 45s) — at 30s the answer persisted but the request 504'd (seen live 2026-06-28).
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const systemId = systemIdFromRequest(req);
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let answer = "";
  try {
    const body = (await req.json()) as { answer?: string };
    answer = (body.answer || "").trim();
  } catch {
    /* empty */
  }
  if (!answer) {
    return NextResponse.json({ error: "answer is required" }, { status: 400 });
  }
  await answerTask(taskId, answer, systemId);
  // The grower just gave the Brain new information — re-derive its state so the
  // analysis + chat reflect the answer immediately instead of next cron tick.
  // NON-FATAL: the answer is already persisted; a slow/failed Brain call must
  // not turn a successful save into an error for the grower.
  let reeval: Record<string, unknown> | null = null;
  try {
    reeval = await reevalSystem(systemId, "grower-answer");
  } catch (e) {
    console.error("[tasks/answer] reeval failed (answer saved fine):", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true, reeval_status: (reeval?.status as string) ?? null });
}
