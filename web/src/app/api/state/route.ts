import { NextResponse } from "next/server";
import { getRecentReadings, getRecentDecisions, getPendingTasks, SYSTEM_ID } from "@/lib/db";

export const maxDuration = 15;

export async function GET() {
  try {
    const [readings, decisions, pending] = await Promise.all([
      getRecentReadings(24, 1),
      getRecentDecisions(1),
      getPendingTasks(),
    ]);
    const current = readings.length > 0 ? readings[readings.length - 1] : null;
    const last = decisions[0] || null;

    const priorityCounts: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
    for (const t of pending) priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;

    return NextResponse.json({
      agent: {
        cycle_count: decisions.length,
        next_ai_seconds: 3600,
        mock_mode: false,
        model: process.env.CHAT_MODEL || "claude-sonnet-4-6",
      },
      current_reading: current
        ? {
            timestamp: current.ts.toISOString(),
            ph: current.ph,
            ec: current.ec,
            tds: current.tds,
            orp: current.orp,
            water_temp: current.water_temp,
            cf: current.cf,
            salinity: current.salinity,
            sg: current.sg,
            source: current.source,
          }
        : null,
      last_decision: last
        ? {
            id: last.id,
            timestamp: last.ts.toISOString(),
            status: last.status,
            analysis: last.analysis,
            message: last.message,
            raw_response: last.raw_response,
            tokens_input: last.tokens_input,
            tokens_output: last.tokens_output,
            cache_creation_tokens: last.cache_creation_tokens,
            cache_read_tokens: last.cache_read_tokens,
          }
        : null,
      pending_tasks: { total: pending.length, by_priority: priorityCounts },
      system_profile: {
        system_type: process.env.SYSTEM_TYPE || "nft_wall_mounted",
        reservoir_liters: Number(process.env.RESERVOIR_LITERS || 60),
        crop_type: process.env.CROP_TYPE || "lettuce",
        growth_stage: process.env.GROWTH_STAGE || "vegetative",
        location: process.env.LOCATION || "Tel Aviv, Israel",
        outdoor: true,
      },
      system_id: SYSTEM_ID,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
