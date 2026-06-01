/**
 * POST /api/tasks/:id/answer — answer a `question` task with free text.
 * Stores the answer, completes the task, and feeds it into Grower Memory so the
 * Brain uses it. Body: { answer: string }.
 */
import { NextResponse } from "next/server";
import { answerTask } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";

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
  return NextResponse.json({ ok: true });
}
