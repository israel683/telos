/**
 * POST /api/sensor/ingest
 *
 * Ingestion endpoint for sensor readings PUSHED to Telos by an external
 * source (typically a Home Assistant automation triggered on entity-state
 * change).  Replaces the cron-poll path for systems whose device_source
 * has been switched to 'home_assistant'.
 *
 * Auth: Bearer INGEST_SECRET (separate from CRON_SECRET — different
 * threat model; this secret lives in the grower's Home Assistant config
 * and is reachable from their LAN).
 *
 * Payload:
 * {
 *   "system_id": "--xyz",          // required — which Telos system this reading is for
 *   "source": "home_assistant",    // optional, defaults to "home_assistant"
 *   "ts": "2026-05-26T10:30:00Z",  // optional ISO timestamp; defaults to now()
 *   "readings": {                  // required; provide whatever HA has
 *     "water_temp": 23.5,
 *     "ph":        6.2,            // any subset of these — missing = null
 *     "ec":        1840,
 *     "tds":       920,
 *     "orp":       210,
 *     "cf":        18.4,
 *     "salinity":  910,
 *     "sg":        1.001
 *   }
 * }
 */
import { NextResponse } from "next/server";
import { saveReading, getSystem } from "@/lib/db";

export const maxDuration = 10;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.INGEST_SECRET || "";
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

// Coerce HA's free-form numeric strings ("unavailable", "unknown", "23.4")
// to either a finite number or null.  HA loves to send strings — accept both.
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (!t || t === "unavailable" || t === "unknown" || t === "none") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: {
    system_id?: string;
    source?: string;
    ts?: string;
    readings?: Record<string, unknown>;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const systemId = (body.system_id || "").trim();
  if (!systemId) {
    return NextResponse.json({ error: "system_id is required" }, { status: 400 });
  }
  const sys = await getSystem(systemId);
  if (!sys) {
    return NextResponse.json(
      { error: `system '${systemId}' not found` },
      { status: 404 }
    );
  }
  const r = body.readings ?? {};
  // Friendly aliases — HA users often map entities to natural names.
  const ph         = num(r.ph)         ?? num(r.PH);
  const ec         = num(r.ec)         ?? num(r.EC);
  const tds        = num(r.tds)        ?? num(r.TDS);
  const orp        = num(r.orp)        ?? num(r.ORP);
  const water_temp = num(r.water_temp) ?? num(r.temp) ?? num(r.temperature);
  const cf         = num(r.cf);
  const salinity   = num(r.salinity);
  const sg         = num(r.sg)         ?? num(r.SG);

  // Refuse fully-empty payloads — almost certainly a misconfigured automation.
  const anyValue = [ph, ec, tds, orp, water_temp, cf, salinity, sg].some(
    (v) => v !== null
  );
  if (!anyValue) {
    return NextResponse.json(
      {
        error: "no usable readings in payload",
        hint: "expected keys: ph, ec, tds, orp, water_temp (or temp), cf, salinity, sg",
        received: r,
      },
      { status: 400 }
    );
  }

  const ts = body.ts ? new Date(body.ts) : new Date();
  if (Number.isNaN(ts.getTime())) {
    return NextResponse.json({ error: "ts is not a valid timestamp" }, { status: 400 });
  }

  await saveReading(
    {
      ts,
      ph,
      ec,
      tds,
      orp,
      water_temp,
      cf,
      salinity,
      sg,
      source: body.source || "home_assistant",
    },
    systemId
  );

  return NextResponse.json({
    ok: true,
    system_id: systemId,
    saved: {
      ts: ts.toISOString(),
      ph,
      ec,
      tds,
      orp,
      water_temp,
      cf,
      salinity,
      sg,
    },
  });
}
