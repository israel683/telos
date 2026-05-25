/**
 * Sensor polling cron — iterates over all active systems.
 *
 * For each active system, reads its sensor via Tuya Thing API (using the
 * system's own tuya_device_id if set, else the env default) and writes one
 * row to sensor_readings scoped by system_id.
 *
 * Configured via vercel.json to run every 5 minutes.
 */
import { NextResponse } from "next/server";
import { saveReading, listSystems } from "@/lib/db";
import { readTuyaSensor } from "@/lib/devices/tuya";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (req.headers.get("x-vercel-cron")) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const results: Array<{
    system_id: string;
    ok: boolean;
    online?: boolean;
    skipped?: string;
    error?: string;
    duration_ms: number;
  }> = [];

  try {
    const systems = (await listSystems()).filter((s) => s.status === "active");
    for (const sys of systems) {
      // Systems whose readings arrive via push (Home Assistant, generic
      // webhook) don't need a Tuya cloud round-trip here — skip them.
      // Telos gets their data via POST /api/sensor/ingest instead.
      if (sys.device_source && sys.device_source !== "tuya_cloud") {
        results.push({
          system_id: sys.id,
          ok: true,
          skipped: `device_source=${sys.device_source}`,
          duration_ms: 0,
        });
        continue;
      }
      const t0 = Date.now();
      try {
        const reading = await readTuyaSensor({ deviceId: sys.tuya_device_id ?? undefined });
        await saveReading(
          {
            ph: reading.ph,
            ec: reading.ec,
            tds: reading.tds,
            orp: reading.orp,
            water_temp: reading.water_temp,
            cf: reading.cf,
            salinity: reading.salinity,
            sg: reading.sg,
            source: reading.source,
          },
          sys.id
        );
        results.push({
          system_id: sys.id,
          ok: true,
          online: reading.online,
          duration_ms: Date.now() - t0,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[cron/poll] system=${sys.id} error:`, msg);
        results.push({
          system_id: sys.id,
          ok: false,
          error: msg,
          duration_ms: Date.now() - t0,
        });
      }
    }
    return NextResponse.json({
      ok: true,
      systems_polled: results.length,
      results,
      duration_ms: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/poll] fatal:", msg);
    return NextResponse.json({ ok: false, error: msg, results }, { status: 500 });
  }
}
