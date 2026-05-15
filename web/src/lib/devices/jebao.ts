/**
 * Jebao MD-4.5 dosing pump — Gizwits Cloud API.
 * Ported from devices/jebao_doser.py.
 *
 * Protocol verified against chrisc123/jebao_aqua-homeassistant:
 *  - Jebao Aqua Android app_id: c3703c4888ec4736a3a0d9425c321604
 *  - Login: /app/smart_home/login/pwd on the appropriate regional aepapp.
 *  - Control: PUT-like POST to /app/control/{did} with attrs { channe<N>: bool }.
 *  - Doser has 5 channels exposed as channe1..channe5 (NOT channel1).
 *  - Dose math: switch ON → sleep(ml/50 * 60s) → switch OFF.  50 ml/min spec.
 */
const JEBAO_AQUA_APP_ID = "c3703c4888ec4736a3a0d9425c321604";

const REGION_URLS = {
  eu: {
    login: "https://euaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://euapi.gizwits.com/app/bindings",
    control: (did: string) => `https://euapi.gizwits.com/app/control/${did}`,
  },
  us: {
    login: "https://usaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://usapi.gizwits.com/app/bindings",
    control: (did: string) => `https://usapi.gizwits.com/app/control/${did}`,
  },
  cn: {
    login: "https://aep-app.gizwits.com/app/smart_home/login/pwd",
    bind: "https://api.gizwits.com/app/bindings",
    control: (did: string) => `https://api.gizwits.com/app/control/${did}`,
  },
} as const;

type Region = keyof typeof REGION_URLS;

// Channel mapping reflects the actual physical setup on this dosing controller:
// Terra Aquatica Tri Part nutrient stack + pH UP only (no pH DOWN installed).
// Channel 5 is physically wired but currently unused.
export const CHANNEL_MAP: Record<
  "micro" | "grow" | "bloom" | "ph_up",
  number
> = {
  micro: 1,  // Terra Aquatica Micro, NPK 5-0-1
  grow: 2,   // Terra Aquatica Grow,  NPK 3-1-6
  bloom: 3,  // Terra Aquatica Bloom, NPK 0-5-4
  ph_up: 4,  // pH Up (potassium hydroxide solution)
};

export const CHANNEL_LABELS_HE: Record<keyof typeof CHANNEL_MAP, string> = {
  micro: "Micro",
  grow: "Grow",
  bloom: "Bloom",
  ph_up: "pH Up",
};

const FLOW_RATE_ML_PER_MIN = 50;

type SessionCache = {
  token: string;
  region: Region;
  deviceId: string;
  expiresAt: number;
};
let _session: SessionCache | null = null;

async function login(region: Region, username: string, password: string): Promise<string | null> {
  const body = {
    appKey: JEBAO_AQUA_APP_ID,
    data: { account: username, password, lang: "en", refreshToken: true },
    version: "1.0",
  };
  try {
    const r = await fetch(REGION_URLS[region].login, {
      method: "POST",
      headers: {
        "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await r.json()) as {
      error?: boolean;
      data?: { userToken?: string };
    };
    if (data.error || !data.data?.userToken) return null;
    return data.data.userToken;
  } catch {
    return null;
  }
}

// MD-4.5 product key (verified 2026-05-07). After a physical device reset
// the did changes, but the product_key stays the same — so we match by it.
const MD45_PRODUCT_KEY = "5ab6019f2dbb4ae7a42b48d2b8ce0530";

type BoundDevice = {
  did: string;
  product_key?: string;
  is_online?: boolean;
  dev_alias?: string;
};

async function loginAndListDevices(forceRefresh = false): Promise<{
  region: Region;
  token: string;
  devices: BoundDevice[];
}> {
  const username = required("JEBAO_USERNAME");
  const password = required("JEBAO_PASSWORD");
  const configuredRegion = (process.env.JEBAO_REGION as Region | undefined) || "us";
  const tryOrder: Region[] = [
    configuredRegion,
    ...(Object.keys(REGION_URLS) as Region[]).filter((r) => r !== configuredRegion),
  ];

  let token: string | null = null;
  let usedRegion: Region | null = null;
  for (const region of tryOrder) {
    token = await login(region, username, password);
    if (token) {
      usedRegion = region;
      break;
    }
  }
  if (!token || !usedRegion) throw new Error("Jebao login failed in all regions");

  const r = await fetch(REGION_URLS[usedRegion].bind, {
    headers: {
      "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
      "X-Gizwits-User-token": token,
      Accept: "application/json",
    },
    cache: forceRefresh ? "no-store" : "default",
  });
  const data = (await r.json()) as { devices?: BoundDevice[] };
  return { region: usedRegion, token, devices: data.devices ?? [] };
}

async function ensureSession(): Promise<SessionCache> {
  if (_session && Date.now() < _session.expiresAt) return _session;

  const { region, token, devices } = await loginAndListDevices(true);
  if (devices.length === 0) throw new Error("No Jebao device bound to this account");

  // Prefer: the MD-4.5 doser, online, with the most recent state.
  // Fall back to: any online device, then any device at all.
  const md45 = devices.filter((d) => d.product_key === MD45_PRODUCT_KEY);
  const candidates = md45.length > 0 ? md45 : devices;
  const picked =
    candidates.find((d) => d.is_online) ?? candidates[0];

  if (!picked.did) throw new Error("Bound device has no did");

  console.log(
    `[jebao] picked device did=${picked.did} alias=${picked.dev_alias ?? "?"} online=${picked.is_online} (of ${devices.length} bound)`
  );

  _session = {
    token,
    region,
    deviceId: picked.did,
    expiresAt: Date.now() + 5 * 60 * 1000, // shortened from 30→5 min so resets recover faster
  };
  return _session;
}

// Exported for diagnostic / debug endpoint
export async function listJebaoBindings(): Promise<BoundDevice[]> {
  const { devices } = await loginAndListDevices(true);
  return devices;
}

export function clearJebaoSession(): void {
  _session = null;
}

async function setChannel(
  physicalChannel: number,
  on: boolean,
  allowReauth = true
): Promise<{ ok: boolean; status?: number; body?: string }> {
  const s = await ensureSession();
  const attrName = `channe${physicalChannel}`;
  const r = await fetch(REGION_URLS[s.region].control(s.deviceId), {
    method: "POST",
    headers: {
      "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
      "X-Gizwits-User-token": s.token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ attrs: { [attrName]: on } }),
  });

  if (r.ok) return { ok: true, status: r.status };

  // Capture body for diagnostics; small payload from Gizwits.
  const body = await r.text().catch(() => "");
  console.error(
    `[jebao] setChannel channe${physicalChannel}=${on} failed: HTTP ${r.status}  body=${body.slice(0, 300)}`
  );

  // Auth-ish failure → invalidate session and retry once with a fresh token.
  if (allowReauth && (r.status === 401 || r.status === 403)) {
    console.warn("[jebao] reauthing and retrying once");
    _session = null;
    return setChannel(physicalChannel, on, false);
  }

  return { ok: false, status: r.status, body };
}

export type DoseResult = {
  success: boolean;
  channel: keyof typeof CHANNEL_MAP;
  amount_ml: number;
  runtime_seconds: number;
  error?: string;
};

/**
 * Dose: switch ON → wait the calculated runtime → switch OFF.
 *
 * Note: this is a synchronous-ish operation. The function awaits the full
 * runtime before returning. For Vercel Function timeouts (10s default,
 * 60s with `export const maxDuration = 60`), dose amounts up to ~50 ml
 * (=60s) are safe. Anything bigger gets capped by safety anyway.
 */
export async function doseChannel(
  channel: keyof typeof CHANNEL_MAP,
  amountMl: number,
  reason: string
): Promise<DoseResult> {
  const physical = CHANNEL_MAP[channel];
  if (!physical) {
    return { success: false, channel, amount_ml: amountMl, runtime_seconds: 0, error: "unmapped channel" };
  }
  const runtimeSeconds = (amountMl / FLOW_RATE_ML_PER_MIN) * 60;

  console.log(`[jebao] dosing ${amountMl}ml on channe${physical} (${channel}) — ${runtimeSeconds.toFixed(2)}s · ${reason}`);

  const onResp = await setChannel(physical, true);
  if (!onResp.ok) {
    return {
      success: false,
      channel,
      amount_ml: amountMl,
      runtime_seconds: runtimeSeconds,
      error: `switch ON failed (HTTP ${onResp.status ?? "?"}${onResp.body ? ": " + onResp.body.slice(0, 150) : ""})`,
    };
  }

  try {
    await new Promise((res) => setTimeout(res, runtimeSeconds * 1000));
  } finally {
    const offResp = await setChannel(physical, false);
    if (!offResp.ok) {
      return {
        success: false,
        channel,
        amount_ml: amountMl,
        runtime_seconds: runtimeSeconds,
        error: `CRITICAL: switch OFF failed — pump may be stuck on (HTTP ${offResp.status ?? "?"})`,
      };
    }
  }

  return { success: true, channel, amount_ml: amountMl, runtime_seconds: runtimeSeconds };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
