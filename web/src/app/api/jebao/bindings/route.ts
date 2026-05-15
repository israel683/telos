/**
 * Diagnostic endpoint: list all devices bound to the Jebao Aqua / Gizwits
 * account. Useful after a physical device reset to confirm which `did` is
 * current and whether the device is online.
 *
 * Auth: CRON_SECRET (same as the other privileged endpoints).
 */
import { NextResponse } from "next/server";
import { listJebaoBindings, clearJebaoSession } from "@/lib/devices/jebao";

export const maxDuration = 15;

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Clear cached session so we hit Gizwits fresh.
  clearJebaoSession();
  try {
    const devices = await listJebaoBindings();
    return NextResponse.json({
      count: devices.length,
      devices: devices.map((d) => ({
        did: d.did,
        dev_alias: d.dev_alias ?? null,
        product_key: d.product_key ?? null,
        is_online: d.is_online ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  // POST = explicit "clear session" for callers that want to force re-auth.
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  clearJebaoSession();
  return NextResponse.json({ ok: true, cleared: true });
}
