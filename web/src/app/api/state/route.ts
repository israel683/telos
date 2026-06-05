import { NextResponse } from "next/server";
import { getRecentReadings, getRecentDecisions, getPendingTasks, getSystem } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";

export const maxDuration = 15;

export async function GET(req: Request) {
  const systemId = systemIdFromRequest(req);
  try {
    const [readings, decisions, pending, sys] = await Promise.all([
      getRecentReadings(24, 1, systemId),
      getRecentDecisions(1, systemId),
      getPendingTasks(systemId),
      getSystem(systemId),
    ]);
    if (!sys) {
      return NextResponse.json({ error: `system "${systemId}" not found` }, { status: 404 });
    }
    const current = readings.length > 0 ? readings[readings.length - 1] : null;
    const last = decisions[0] || null;

    const priorityCounts: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
    for (const t of pending) priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;

    return NextResponse.json({
      agent: {
        cycle_count: decisions.length,
        next_ai_seconds: sys.ai_cycle_minutes * 60,
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
            // Token telemetry intentionally omitted — internal-only (reveals the
            // LLM + cost structure). Kept in logs/observability, not the API.
            id: last.id,
            timestamp: last.ts.toISOString(),
            status: last.status,
            analysis: last.analysis,
            message: last.message,
            raw_response: last.raw_response,
          }
        : null,
      pending_tasks: { total: pending.length, by_priority: priorityCounts },
      system_profile: {
        system_type: sys.system_type,
        reservoir_liters: sys.reservoir_liters,
        crop_type: sys.crop_type,
        growth_stage: sys.growth_stage,
        location: sys.location,
        outdoor: sys.outdoor,
      },
      system: {
        id: sys.id,
        name: sys.name,
        status: sys.status,
      },
      system_id: sys.id,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
