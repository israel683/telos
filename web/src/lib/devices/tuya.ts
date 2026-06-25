/**
 * Tuya PH-W218 8-in-1 water quality sensor — Thing API (v2.0).
 * Ported from devices/tuya_sensor.py.
 *
 * The 8 metrics live behind /v2.0/cloud/thing/{deviceId}/shadow/properties
 * (NOT the legacy /v1.0/devices/{id}/status which only returns temp_current).
 */
import crypto from "crypto";

type TuyaConfig = {
  accessId: string;
  accessSecret: string;
  endpoint: string;   // e.g. https://openapi.tuyaeu.com
  deviceId: string;
};

export type TuyaReading = {
  ts: Date;
  ph: number | null;
  ec: number | null;
  tds: number | null;
  orp: number | null;
  water_temp: number | null;
  cf: number | null;
  salinity: number | null;
  sg: number | null;
  online: boolean;
  source: "tuya_ph_w218";
};

// Mapping: Tuya DP code → (WaterReading field, scale divisor)
// Scales verified against the live PH-W218 Thing model.
const DP_MAPPING: Record<string, [keyof Omit<TuyaReading, "ts" | "online" | "source">, number]> = {
  temp_current:     ["water_temp", 10],
  ph_current:       ["ph",         100],
  tds_current:      ["tds",        1],
  ec_current:       ["ec",         1],
  salinity_current: ["salinity",   1],
  pro_current:      ["sg",         1000],  // Tuya names S.G. as "pro"
  orp_current:      ["orp",        1],
  cf_current:       ["cf",         100],
};

const ZERO_INVALID_FIELDS = new Set(["ec", "tds", "salinity", "cf"]);

let _cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(cfg: TuyaConfig): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt - 30_000) {
    return _cachedToken.token;
  }
  const t = Date.now().toString();
  const nonce = "";
  const stringToSign = ["GET", crypto.createHash("sha256").update("").digest("hex"), "", "/v1.0/token?grant_type=1"].join("\n");
  const str = cfg.accessId + t + nonce + stringToSign;
  const sign = crypto.createHmac("sha256", cfg.accessSecret).update(str).digest("hex").toUpperCase();

  const r = await fetch(`${cfg.endpoint}/v1.0/token?grant_type=1`, {
    headers: {
      client_id: cfg.accessId,
      sign,
      sign_method: "HMAC-SHA256",
      t,
      nonce,
    },
  });
  const data = (await r.json()) as {
    success: boolean;
    result?: { access_token: string; expire_time: number };
    msg?: string;
  };
  if (!data.success || !data.result) {
    throw new Error(`Tuya auth failed: ${data.msg || JSON.stringify(data)}`);
  }
  _cachedToken = {
    token: data.result.access_token,
    expiresAt: Date.now() + data.result.expire_time * 1000,
  };
  return _cachedToken.token;
}

async function signedGet(cfg: TuyaConfig, path: string): Promise<unknown> {
  const token = await getAccessToken(cfg);
  const t = Date.now().toString();
  const nonce = "";
  const bodyHash = crypto.createHash("sha256").update("").digest("hex");
  const stringToSign = ["GET", bodyHash, "", path].join("\n");
  const str = cfg.accessId + token + t + nonce + stringToSign;
  const sign = crypto.createHmac("sha256", cfg.accessSecret).update(str).digest("hex").toUpperCase();

  const r = await fetch(`${cfg.endpoint}${path}`, {
    headers: {
      client_id: cfg.accessId,
      access_token: token,
      sign,
      sign_method: "HMAC-SHA256",
      t,
      nonce,
    },
  });
  return r.json();
}

/**
 * Lightweight device identity + liveness from Tuya's device endpoint
 * (/v1.0/devices/{id}) — the `name` the grower gave the sensor in the Tuya app
 * plus its online flag. Used to CONFIRM the bound sensor during onboarding
 * ("אני רואה חיישן בשם X, מקוון — זה שלך?"). Never throws: returns
 * configured:false when Tuya env is absent, found:false on any API failure.
 */
export async function getTuyaDeviceInfo(deviceId?: string): Promise<{
  configured: boolean;
  found: boolean;
  deviceId: string | null;
  name: string | null;
  online: boolean;
}> {
  const accessId = process.env.TUYA_ACCESS_ID;
  const accessSecret = process.env.TUYA_ACCESS_SECRET;
  const id = deviceId || process.env.TUYA_SENSOR_DEVICE_ID;
  if (!accessId || !accessSecret || !id) {
    return { configured: false, found: false, deviceId: id ?? null, name: null, online: false };
  }
  const cfg: TuyaConfig = {
    accessId,
    accessSecret,
    endpoint: process.env.TUYA_API_ENDPOINT || "https://openapi.tuyaeu.com",
    deviceId: id,
  };
  try {
    const info = (await signedGet(cfg, `/v1.0/devices/${id}`)) as {
      result?: { online?: boolean; name?: string };
    };
    return {
      configured: true,
      found: Boolean(info?.result),
      deviceId: id,
      name: info?.result?.name ?? null,
      online: Boolean(info?.result?.online),
    };
  } catch {
    return { configured: true, found: false, deviceId: id, name: null, online: false };
  }
}

export async function readTuyaSensor(opts: { deviceId?: string } = {}): Promise<TuyaReading> {
  const cfg: TuyaConfig = {
    accessId: required("TUYA_ACCESS_ID"),
    accessSecret: required("TUYA_ACCESS_SECRET"),
    endpoint: process.env.TUYA_API_ENDPOINT || "https://openapi.tuyaeu.com",
    deviceId: opts.deviceId || required("TUYA_SENSOR_DEVICE_ID"),
  };

  // Online status (informational)
  let online = false;
  try {
    const info = (await signedGet(cfg, `/v1.0/devices/${cfg.deviceId}`)) as {
      result?: { online?: boolean };
    };
    online = Boolean(info?.result?.online);
  } catch {
    // non-fatal
  }

  const shadow = (await signedGet(
    cfg,
    `/v2.0/cloud/thing/${cfg.deviceId}/shadow/properties`
  )) as {
    success: boolean;
    result?: { properties: Array<{ code: string; value: number | null }> };
    msg?: string;
  };
  if (!shadow.success || !shadow.result) {
    throw new Error(`Tuya thing API failed: ${shadow.msg || JSON.stringify(shadow)}`);
  }

  const reading: TuyaReading = {
    ts: new Date(),
    ph: null,
    ec: null,
    tds: null,
    orp: null,
    water_temp: null,
    cf: null,
    salinity: null,
    sg: null,
    online,
    source: "tuya_ph_w218",
  };

  for (const prop of shadow.result.properties) {
    const mapping = DP_MAPPING[prop.code];
    if (!mapping || prop.value === null) continue;
    const [field, divisor] = mapping;
    const scaled = prop.value / divisor;

    // Treat 0 readings on conductivity-based probes as "probe not in solution"
    if (ZERO_INVALID_FIELDS.has(field) && scaled === 0) continue;
    if (field === "sg" && scaled < 0.5) continue;

    reading[field] = scaled;
  }

  return reading;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
