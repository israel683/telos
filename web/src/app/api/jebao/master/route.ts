/**
 * Emergency master-switch control for the Jebao doser. POST { on: bool }
 * to flip the device's master `switch` attribute. Use case: after a stuck
 * state, force everything off; or arm the device before a manual cycle.
 *
 * Auth: CRON_SECRET.
 */
import { NextResponse } from "next/server";

const JEBAO_AQUA_APP_ID = "c3703c4888ec4736a3a0d9425c321604";
const REGION_URLS: Record<string, { login: string; bind: string; control: (did: string) => string }> = {
  eu: {
    login: "https://euaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://euapi.gizwits.com/app/bindings",
    control: (did) => `https://euapi.gizwits.com/app/control/${did}`,
  },
  us: {
    login: "https://usaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://usapi.gizwits.com/app/bindings",
    control: (did) => `https://usapi.gizwits.com/app/control/${did}`,
  },
  cn: {
    login: "https://aep-app.gizwits.com/app/smart_home/login/pwd",
    bind: "https://api.gizwits.com/app/bindings",
    control: (did) => `https://api.gizwits.com/app/control/${did}`,
  },
};

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  return Boolean(cronSecret && auth === `Bearer ${cronSecret}`);
}

export const maxDuration = 15;

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    on?: boolean;
    all_channels?: boolean;
  };
  const on = Boolean(body.on);
  const alsoChannels = body.all_channels !== false; // default true

  const username = process.env.JEBAO_USERNAME!;
  const password = process.env.JEBAO_PASSWORD!;
  const region = process.env.JEBAO_REGION || "us";

  try {
    const loginRes = await fetch(REGION_URLS[region].login, {
      method: "POST",
      headers: { "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID, "Content-Type": "application/json" },
      body: JSON.stringify({
        appKey: JEBAO_AQUA_APP_ID,
        data: { account: username, password, lang: "en", refreshToken: true },
        version: "1.0",
      }),
    });
    const loginData = (await loginRes.json()) as { data?: { userToken?: string } };
    const token = loginData.data?.userToken;
    if (!token) return NextResponse.json({ error: "login failed" }, { status: 500 });

    const bindRes = await fetch(REGION_URLS[region].bind, {
      headers: { "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID, "X-Gizwits-User-token": token },
    });
    const bindData = (await bindRes.json()) as { devices?: Array<{ did: string }> };
    const did = bindData.devices?.[0]?.did;
    if (!did) return NextResponse.json({ error: "no device bound" }, { status: 404 });

    // Build attrs: master + (optionally) all channels + ALL TIMERS to OFF.
    // After a physical reset the device can enter built-in calibration mode
    // (CALSet="校准1") which pulses pumps autonomously, ignoring the cloud's
    // manual switches. Multiple attempts to cancel cover the unknown firmware
    // contract:
    //   - CALSW false      (calibration switch OFF)
    //   - Calib1..5 false  (per-channel calibration flags)
    //   - All channels/timers/master OFF as before
    const attrs: Record<string, boolean | number | string> = { switch: on };
    if (alsoChannels) {
      for (let i = 1; i <= 8; i++) attrs[`channe${i}`] = false;
      for (let i = 1; i <= 8; i++) attrs[`Timer${i}ON`] = false;
      for (let i = 1; i <= 5; i++) attrs[`Calib${i}`] = false;
      attrs.CALSW = false;
    }

    const ctlRes = await fetch(REGION_URLS[region].control(did), {
      method: "POST",
      headers: {
        "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
        "X-Gizwits-User-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ attrs }),
    });

    const ctlBody = await ctlRes.text();
    return NextResponse.json({
      ok: ctlRes.ok,
      status: ctlRes.status,
      sent: attrs,
      body: ctlBody.slice(0, 500),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
