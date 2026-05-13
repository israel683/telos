import { NextResponse } from "next/server";
import { getRecentReadings } from "@/lib/db";

export const maxDuration = 15;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hours = Math.max(1, Math.min(24 * 30, Number(searchParams.get("hours") || 24)));
  const limit = Math.max(10, Math.min(2000, Number(searchParams.get("limit") || 500)));
  try {
    const readings = await getRecentReadings(hours, limit);
    return NextResponse.json({
      readings: readings.map((r) => ({
        timestamp: r.ts.toISOString(),
        ph: r.ph,
        ec: r.ec,
        tds: r.tds,
        orp: r.orp,
        water_temp: r.water_temp,
        cf: r.cf,
        salinity: r.salinity,
        sg: r.sg,
        source: r.source,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
