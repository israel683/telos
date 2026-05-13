import { NextResponse } from "next/server";
import { completeTask } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const taskId = Number(id);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let response = "";
  try {
    const body = (await req.json()) as { response?: string };
    response = body.response || "";
  } catch {
    // empty body is fine
  }
  await completeTask(taskId, response);
  return NextResponse.json({ ok: true });
}
