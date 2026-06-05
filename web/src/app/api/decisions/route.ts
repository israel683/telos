import { NextResponse } from "next/server";
import { getRecentDecisions } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";

export const maxDuration = 15;

export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") || 20)));
  try {
    const decisions = await getRecentDecisions(limit, systemId);
    return NextResponse.json({
      system_id: systemId,
      // Token telemetry is intentionally NOT returned — it reveals the LLM and
      // cost structure (proprietary). It stays in server logs/observability.
      decisions: decisions.map((d) => ({
        id: d.id,
        timestamp: d.ts.toISOString(),
        status: d.status,
        analysis: d.analysis,
        message: d.message,
        raw_response: d.raw_response,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
