/**
 * Out-of-app notifications (email) — the channel that reaches the grower when
 * they're NOT in the app. Until this existed, a pH crash, an empty bottle, or a
 * dose the grower must perform by hand only surfaced on the next visit.
 *
 * Lean by design:
 *  - Uses Resend's HTTP API directly via fetch — no SDK dependency.
 *  - Fully gated on env: if RESEND_API_KEY or ALERT_EMAIL_TO is unset, every
 *    call is a no-op that logs and returns {skipped}. So it's safe to ship
 *    before the env is configured; the grower turns it on by setting env vars
 *    in Vercel (no redeploy of logic needed).
 *
 * Env:
 *  - RESEND_API_KEY   — Resend API key.
 *  - ALERT_EMAIL_TO   — recipient (the grower).
 *  - ALERT_EMAIL_FROM — verified sender (default: onboarding@resend.dev, fine
 *                       for testing; use a verified domain for production).
 */

import webpush from "web-push";
import { getPushSubscriptions, deletePushSubscription } from "./db";

export type EmailResult =
  | { ok: true; id?: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped?: false; error: string };

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO);
}

/**
 * Send a plain-text email alert. Never throws — returns a result object so
 * callers (crons) can log without risking the whole run. No-op when unconfigured.
 */
export async function sendAlertEmail(subject: string, text: string): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO;
  const from = process.env.ALERT_EMAIL_FROM || "TELOS <onboarding@resend.dev>";

  if (!apiKey || !to) {
    console.log(`[notify] email skipped (unconfigured) — subject="${subject}"`);
    return { ok: false, skipped: true, reason: "RESEND_API_KEY or ALERT_EMAIL_TO not set" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text }),
      // Don't let a slow mail API hang a cron function.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[notify] resend ${res.status}: ${body.slice(0, 300)}`);
      return { ok: false, error: `resend ${res.status}` };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: json.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[notify] sendAlertEmail failed:", error);
    return { ok: false, error };
  }
}

/* ── Web Push (PWA) — reaches a grower whose app is closed/backgrounded. The
   public VAPID key isn't secret (it ships to the client), so it's embedded as a
   default; the private key is server-env-only. Push goes live once
   VAPID_PRIVATE_KEY is set in Vercel. Email (above) is the fallback channel. ── */

const VAPID_PUBLIC =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BBqYfU0hZK3eXhF9-ctWt8mPmk3G45bV5qK3n-x8nuvezbu5ftMDyeomqwkITik0Jx-qfkOV6aLvfd0-4-HWhu8";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:israel@ferrera.co";

export function pushConfigured(): boolean {
  return !!(VAPID_PRIVATE && VAPID_PUBLIC);
}

/**
 * Send a Web Push notification to every device subscribed for this system.
 * Best-effort, never throws; prunes dead subscriptions (410/404). No-op +
 * {skipped} when VAPID_PRIVATE_KEY is unset.
 */
export async function sendWebPush(
  systemId: string,
  title: string,
  body: string
): Promise<{ sent: number; pruned: number; skipped?: boolean }> {
  if (!pushConfigured()) {
    console.log(`[notify] web-push skipped (no VAPID_PRIVATE_KEY) — "${title}"`);
    return { sent: 0, pruned: 0, skipped: true };
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) {
    console.error("[notify] invalid VAPID config:", e instanceof Error ? e.message : e);
    return { sent: 0, pruned: 0, skipped: true };
  }
  let subs: Awaited<ReturnType<typeof getPushSubscriptions>>;
  try {
    subs = await getPushSubscriptions(systemId);
  } catch (e) {
    console.error("[notify] getPushSubscriptions failed:", e instanceof Error ? e.message : e);
    return { sent: 0, pruned: 0 };
  }
  const payload = JSON.stringify({ title, body, url: "/" });
  let sent = 0;
  let pruned = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400 }
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 410 || code === 404) {
        await deletePushSubscription(sub.endpoint).catch(() => {});
        pruned++;
      } else {
        console.error("[notify] web-push send failed:", e instanceof Error ? e.message : e);
      }
    }
  }
  return { sent, pruned };
}

/**
 * Reach the grower out-of-app on BOTH channels (Web Push + email). Best-effort:
 * each is independently gated + never throws, so a cron run is never at risk.
 */
export async function notifyGrower(systemId: string, subject: string, text: string): Promise<void> {
  const pushBody = text.length > 180 ? `${text.slice(0, 177)}…` : text;
  await Promise.allSettled([
    sendWebPush(systemId, subject, pushBody),
    sendAlertEmail(subject, text),
  ]);
}
