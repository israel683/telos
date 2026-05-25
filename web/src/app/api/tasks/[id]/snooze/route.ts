/**
 * POST /api/tasks/:id/snooze { minutes?: number }
 *
 * Hides a pending task from grower-facing surfaces until N minutes from
 * now.  Used by the chat-thread task widget's "דחיית X" actions when the
 * grower wants to act on it later today without dismissing.
 *
 * Default snooze is 60 minutes.  Caller may pass 15/60/180/720 etc.
 */
import { NextResponse } from "next/server";
import { snoozeTask } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";

export const maxDuration = 10;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const systemId = systemIdFromRequest(req);
  let minutes = 60;
  try {
    const body = (await req.json()) as { minutes?: number };
    if (typeof body.minutes === "number" && body.minutes > 0 && body.minutes <= 24 * 60) {
      minutes = body.minutes;
    }
  } catch {
    // empty body → default 60 minutes
  }
  const until = new Date(Date.now() + minutes * 60_000);
  await snoozeTask(taskId, until, systemId);
  return NextResponse.json({
    ok: true,
    snoozed_until: until.toISOString(),
    minutes,
  });
}
