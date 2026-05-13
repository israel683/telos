import { NextResponse } from "next/server";
import { getRecentDecisions } from "@/lib/db";

export const maxDuration = 15;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") || 20)));
  try {
    const decisions = await getRecentDecisions(limit);
    return NextResponse.json({
      decisions: decisions.map((d) => ({
        id: d.id,
        timestamp: d.ts.toISOString(),
        status: d.status,
        analysis: d.analysis,
        message: d.message,
        raw_response: d.raw_response,
        tokens_input: d.tokens_input,
        tokens_output: d.tokens_output,
        cache_creation_tokens: d.cache_creation_tokens,
        cache_read_tokens: d.cache_read_tokens,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
