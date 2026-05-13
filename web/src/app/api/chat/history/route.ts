import { NextResponse } from "next/server";
import { getChatHistory } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";

export const maxDuration = 15;

export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("thread") || "main";
  const limit = Math.max(10, Math.min(500, Number(searchParams.get("limit") || 200)));
  try {
    const rows = await getChatHistory(systemId, threadId, limit);
    return NextResponse.json({
      system_id: systemId,
      thread_id: threadId,
      messages: rows.map((r) => ({
        id: String(r.id),
        ts: r.ts.toISOString(),
        role: r.role,
        parts: r.parts,
        source: r.source,
        decision_id: r.decision_id,
        status: r.status,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
