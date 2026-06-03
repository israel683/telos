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
