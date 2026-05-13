/**
 * Sensor polling — Vercel Cron entry point.
 *
 * Configured in vercel.json to run every 5 minutes. Reads the PH-W218 via
 * Tuya Thing API and writes one row to sensor_readings.
 *
 * Authorized only via Vercel Cron's signed header OR a shared bearer token.
 */
import { NextResponse } from "next/server";
import { saveReading } from "@/lib/db";
import { readTuyaSensor } from "@/lib/devices/tuya";

export const maxDuration = 30;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  // Vercel Cron always sets this header when invoking
  if (req.headers.get("x-vercel-cron")) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  try {
    const reading = await readTuyaSensor();
    await saveReading({
      ph: reading.ph,
      ec: reading.ec,
      tds: reading.tds,
      orp: reading.orp,
      water_temp: reading.water_temp,
      cf: reading.cf,
      salinity: reading.salinity,
      sg: reading.sg,
      source: reading.source,
    });
    return NextResponse.json({
      ok: true,
      online: reading.online,
      reading: {
        ph: reading.ph,
        ec: reading.ec,
        water_temp: reading.water_temp,
        orp: reading.orp,
      },
      duration_ms: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/poll] error:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
