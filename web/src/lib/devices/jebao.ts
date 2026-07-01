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
    data: (did: string) => `https://euapi.gizwits.com/app/devdata/${did}/latest`,
  },
  us: {
    login: "https://usaepapp.gizwits.com/app/smart_home/login/pwd",
    bind: "https://usapi.gizwits.com/app/bindings",
    control: (did: string) => `https://usapi.gizwits.com/app/control/${did}`,
    data: (did: string) => `https://usapi.gizwits.com/app/devdata/${did}/latest`,
  },
  cn: {
    login: "https://aep-app.gizwits.com/app/smart_home/login/pwd",
    bind: "https://api.gizwits.com/app/bindings",
    control: (did: string) => `https://api.gizwits.com/app/control/${did}`,
    data: (did: string) => `https://api.gizwits.com/app/devdata/${did}/latest`,
  },
} as const;

type Region = keyof typeof REGION_URLS;

// Legacy hardcoded mapping — kept for backward compatibility with code paths
// that haven't been threaded through DosingConfig yet (e.g. CLI scripts,
// older logs).  The authoritative source of channel layout is now the
// per-system `dosing_config` JSONB; see lib/dosing-config.ts.
//
// New code should resolve the physical channel via `getDosingConfig(systemId)`
// and pass it to `doseChannelByPhysical()` instead of indexing this map.
export const CHANNEL_MAP: Record<string, number> = {
  micro: 1,  // Terra Aquatica Micro, NPK 5-0-1
  grow: 2,   // Terra Aquatica Grow,  NPK 3-1-6
  bloom: 3,  // Terra Aquatica Bloom, NPK 0-5-4
  ph_up: 4,  // pH Up (potassium hydroxide solution)
};

export const CHANNEL_LABELS_HE: Record<string, string> = {
  micro: "Micro",
  grow: "Grow",
  bloom: "Bloom",
  ph_up: "pH Up",
  ph_down: "pH Down",
  ad_solution: "AD המושלם",
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
  // On a fresh / reset device the master `switch` attribute defaults to 0,
  // which silently disables ALL channel toggles even though the API returns
  // 200. Co-send `switch: true` on every ON command (idempotent — no-op if
  // already on). OFF commands don't touch the master so it stays enabled
  // between doses in the same cycle.
  const attrs = on
    ? { switch: true, [attrName]: true }
    : { [attrName]: false };
  const r = await fetch(REGION_URLS[s.region].control(s.deviceId), {
    method: "POST",
    headers: {
      "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
      "X-Gizwits-User-token": s.token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ attrs }),
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

/**
 * PANIC STOP — one coordinated batch that forces EVERYTHING off: master
 * switch, all 8 channels, all timer-on flags, CALSW. The last line of defense
 * when a normal per-channel OFF fails mid-dose. Uses the existing session.
 */
export async function panicStopAll(): Promise<{ ok: boolean; status?: number }> {
  try {
    const s = await ensureSession();
    const attrs: Record<string, boolean> = { switch: false, CALSW: false };
    for (let i = 1; i <= 8; i++) {
      attrs[`channe${i}`] = false;
      attrs[`Timer${i}ON`] = false;
    }
    const r = await fetch(REGION_URLS[s.region].control(s.deviceId), {
      method: "POST",
      headers: {
        "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
        "X-Gizwits-User-token": s.token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ attrs }),
    });
    console.error(`[jebao] PANIC STOP fired — HTTP ${r.status}`);
    return { ok: r.ok, status: r.status };
  } catch (e) {
    console.error("[jebao] PANIC STOP threw:", e instanceof Error ? e.message : e);
    return { ok: false };
  }
}

/**
 * Readback: the device's CURRENT reported state for one physical channel
 * (devdata/latest). Source of truth for "did the pump actually turn off" —
 * a 200 on the control call is a request-accepted, not a state guarantee.
 * Returns null when the state can't be determined.
 */
async function readChannelState(physical: number): Promise<boolean | null> {
  try {
    const s = await ensureSession();
    const r = await fetch(REGION_URLS[s.region].data(s.deviceId), {
      headers: {
        "X-Gizwits-Application-Id": JEBAO_AQUA_APP_ID,
        "X-Gizwits-User-token": s.token,
        Accept: "application/json",
      },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { attr?: Record<string, unknown> };
    const v = j.attr?.[`channe${physical}`];
    if (v === undefined || v === null) return null;
    return v === true || v === 1;
  } catch {
    return null;
  }
}

export type DoseResult = {
  success: boolean;
  /** Logical channel key (e.g. "micro" / "ph_up" / "ad_solution"). */
  channel: string;
  /** Physical Jebao channel 1..5 that was actuated. */
  physical_channel: number;
  amount_ml: number;
  runtime_seconds: number;
  error?: string;
  /** Non-fatal anomaly during an otherwise-completed dose (e.g. OFF needed a
   *  retry or the panic path — possible extra ml dispensed during recovery). */
  warning?: string;
  /** STRUCTURED critical flag: the pump could NOT be verified off after the
   *  full recovery ladder (retry → panic-stop → readback). Callers must treat
   *  this as an emergency: urgent task + interrupt notification. */
  pump_stuck?: boolean;
};

/**
 * Core dose primitive — operates on a known physical channel number.
 * Callers who already have a DosingConfig (the brain, dose/test route, etc.)
 * should use this directly to avoid the legacy CHANNEL_MAP fallback.
 *
 * Note: this is a synchronous-ish operation. The function awaits the full
 * runtime before returning. For Vercel Function timeouts (10s default,
 * 60s with `export const maxDuration = 60`), dose amounts up to ~50 ml
 * (=60s) are safe. Anything bigger gets capped by safety anyway.
 */
export async function doseChannelByPhysical(
  physical: number,
  amountMl: number,
  reason: string,
  channelKey: string = `channe${physical}`
): Promise<DoseResult> {
  if (!Number.isInteger(physical) || physical < 1 || physical > 8) {
    return {
      success: false,
      channel: channelKey,
      physical_channel: physical,
      amount_ml: amountMl,
      runtime_seconds: 0,
      error: `invalid physical channel: ${physical}`,
    };
  }
  const runtimeSeconds = (amountMl / FLOW_RATE_ML_PER_MIN) * 60;

  // Device-layer hard clamp: every route that can dose has maxDuration=60s.
  // A shot whose sleep + OFF-recovery ladder (~10s) can't fit means the
  // function may be killed MID-SLEEP — before the OFF — leaving the pump
  // physically on with no software able to stop it. Refuse instead; callers
  // split into smaller doses (safety's max_single_dose_ml is sized to fit).
  const MAX_SINGLE_SHOT_RUNTIME_S = 45;
  if (runtimeSeconds > MAX_SINGLE_SHOT_RUNTIME_S) {
    const maxMl = Math.floor((MAX_SINGLE_SHOT_RUNTIME_S / 60) * FLOW_RATE_ML_PER_MIN);
    return {
      success: false,
      channel: channelKey,
      physical_channel: physical,
      amount_ml: amountMl,
      runtime_seconds: runtimeSeconds,
      error: `dose too large for one shot (${runtimeSeconds.toFixed(0)}s pump runtime exceeds the ${MAX_SINGLE_SHOT_RUNTIME_S}s serverless-safe cap) — split into doses of ≤${maxMl}ml`,
    };
  }

  console.log(
    `[jebao] dosing ${amountMl}ml on channe${physical} (${channelKey}) — ${runtimeSeconds.toFixed(2)}s · ${reason}`
  );

  const onResp = await setChannel(physical, true);
  if (!onResp.ok) {
    return {
      success: false,
      channel: channelKey,
      physical_channel: physical,
      amount_ml: amountMl,
      runtime_seconds: runtimeSeconds,
      error: `switch ON failed (HTTP ${onResp.status ?? "?"}${onResp.body ? ": " + onResp.body.slice(0, 150) : ""})`,
    };
  }

  await new Promise((res) => setTimeout(res, runtimeSeconds * 1000));

  const base = {
    channel: channelKey,
    physical_channel: physical,
    amount_ml: amountMl,
    runtime_seconds: runtimeSeconds,
  };

  // ── OFF recovery ladder ────────────────────────────────────────────────
  // A failed OFF is the one fault that can kill the grow overnight (pump
  // stays on, drains the bottle, crashes pH). Never settle for one attempt:
  // 1. normal OFF (setChannel already re-auths once on 401/403)
  // 2. wait 2s, retry OFF (transient network/API flake is the common case)
  // 3. PANIC STOP (batch everything off) + readback VERIFY — a 200 on
  //    control is request-accepted, not a state guarantee.
  // Only an unverified state after all three earns the structured
  // pump_stuck flag, which callers route to an urgent task + interrupt push.
  const extraMlPerSec = FLOW_RATE_ML_PER_MIN / 60;
  const off1 = await setChannel(physical, false);
  if (off1.ok) return { success: true, ...base };

  await new Promise((res) => setTimeout(res, 2000));
  const off2 = await setChannel(physical, false);
  if (off2.ok) {
    const extra = (2.5 * extraMlPerSec).toFixed(1);
    console.warn(`[jebao] OFF needed a retry on channe${physical} — ~${extra}ml extra dispensed`);
    return {
      success: true,
      ...base,
      warning: `switch OFF needed a retry (~${extra}ml extra dispensed during recovery)`,
    };
  }

  const panic = await panicStopAll();
  await new Promise((res) => setTimeout(res, 2000));
  const state = await readChannelState(physical);
  if (state === false) {
    const extra = (6 * extraMlPerSec).toFixed(1);
    console.error(`[jebao] channe${physical} OFF failed twice; PANIC STOP engaged and VERIFIED off`);
    return {
      success: true,
      ...base,
      warning: `switch OFF failed twice — panic stop engaged and verified off (~${extra}ml extra dispensed; master switch now OFF, next dose re-enables it)`,
    };
  }

  console.error(`[jebao] channe${physical} PUMP STUCK: OFF failed, retry failed, panic ${panic.ok ? "accepted but state unverified" : "ALSO failed"} (readback=${state})`);
  return {
    success: false,
    ...base,
    pump_stuck: true,
    error:
      `CRITICAL: pump could not be verified off — OFF failed twice, panic stop ` +
      (panic.ok ? `accepted but readback shows ${state === null ? "unknown" : "still ON"}` : "ALSO failed") +
      `. Physical intervention may be needed NOW (unplug the doser / close the line).`,
  };
}

/**
 * Backward-compatible wrapper: takes a channel KEY ("micro"/"ph_up"/...) and
 * resolves the physical channel via the legacy CHANNEL_MAP.  Use this only
 * for code paths that don't yet have a per-system DosingConfig (CLI scripts,
 * legacy callers).  New code should use `doseChannelByPhysical` after a
 * `getDosingConfig(systemId)` lookup.
 */
export async function doseChannel(
  channel: string,
  amountMl: number,
  reason: string
): Promise<DoseResult> {
  const physical = CHANNEL_MAP[channel];
  if (!physical) {
    return {
      success: false,
      channel,
      physical_channel: 0,
      amount_ml: amountMl,
      runtime_seconds: 0,
      error: `unmapped channel '${channel}' — pass a known key or use doseChannelByPhysical`,
    };
  }
  return doseChannelByPhysical(physical, amountMl, reason, channel);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
