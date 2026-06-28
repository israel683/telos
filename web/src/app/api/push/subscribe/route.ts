/**
 * POST /api/push/subscribe { subscription } — store a browser/device Web Push
 * subscription for the active system, so the cron can alert the grower when their
 * app is closed. Idempotent (upsert by endpoint).
 */
import { NextResponse } from "next/server";
import { savePushSubscription } from "@/lib/db";
import { systemIdFromRequest } from "@/lib/system-ctx";
import { sendWebPush } from "@/lib/notify";

export const maxDuration = 15;

export async function POST(req: Request) {
  const systemId = systemIdFromRequest(req);
  let body: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "invalid push subscription" }, { status: 400 });
  }
  try {
    await savePushSubscription(systemId, {
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    });
    // Immediate confirmation push so the grower KNOWS it works (and the whole
    // pipeline is verified end-to-end). Best-effort + no-op when VAPID is unset
    // — never fail the subscribe over it.
    try {
      await sendWebPush(systemId, "TELOS", "התראות מופעלות ✓ — מכאן אעדכן אותך כשצריך.");
    } catch {
      // ignore — subscription is saved regardless
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
