#!/usr/bin/env node
// One-shot live probe of the Tuya PH-W218 sensor.
// Reads TUYA_* env from .env.diagnostic (pulled via `vercel env pull`)
// and hits Tuya Cloud's Thing API directly to dump current state.

import { readFileSync } from "node:fs";
import crypto from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.diagnostic", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1);
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      return [l.slice(0, i), v];
    })
);

const ENDPOINT = env.TUYA_API_ENDPOINT;
const ACCESS_ID = env.TUYA_ACCESS_ID;
const ACCESS_SECRET = env.TUYA_ACCESS_SECRET;
const DEVICE_ID = env.TUYA_SENSOR_DEVICE_ID;

if (!ENDPOINT || !ACCESS_ID || !ACCESS_SECRET || !DEVICE_ID) {
  console.error("[probe] missing TUYA_* env vars");
  process.exit(1);
}

console.log(`[probe] endpoint=${ENDPOINT} device=${DEVICE_ID}`);

// --- Tuya signing ---
function sign(method, path, body, accessToken = "") {
  const t = Date.now().toString();
  const nonce = "";
  const contentHash = crypto
    .createHash("sha256")
    .update(body || "")
    .digest("hex");
  const stringToSign = [method, contentHash, "", path].join("\n");
  const str = ACCESS_ID + accessToken + t + nonce + stringToSign;
  const signature = crypto
    .createHmac("sha256", ACCESS_SECRET)
    .update(str)
    .digest("hex")
    .toUpperCase();
  return {
    "client_id": ACCESS_ID,
    "sign": signature,
    "t": t,
    "sign_method": "HMAC-SHA256",
    "access_token": accessToken,
    "Content-Type": "application/json",
  };
}

// Step 1: get access token
const tokPath = "/v1.0/token?grant_type=1";
const tokRes = await fetch(`${ENDPOINT}${tokPath}`, {
  method: "GET",
  headers: sign("GET", tokPath, ""),
}).then((r) => r.json());

if (!tokRes.success) {
  console.error("[probe] auth failed:", JSON.stringify(tokRes));
  process.exit(2);
}
const token = tokRes.result.access_token;
console.log("[probe] auth OK\n");

// Step 2: device basics
const devPath = `/v1.0/devices/${DEVICE_ID}`;
const devRes = await fetch(`${ENDPOINT}${devPath}`, {
  method: "GET",
  headers: sign("GET", devPath, "", token),
}).then((r) => r.json());

if (!devRes.success) {
  console.error("[probe] device fetch failed:", JSON.stringify(devRes));
  process.exit(3);
}
const d = devRes.result;
console.log("=== DEVICE ===");
console.log(`name        : ${d.name}`);
console.log(`product_name: ${d.product_name}`);
console.log(`category    : ${d.category}`);
console.log(`online      : ${d.online}`);
console.log(`ip          : ${d.ip}`);
console.log(`local_key   : ${d.local_key ? "✓ available (length=" + d.local_key.length + ")" : "✗ missing"}`);
console.log(`uuid        : ${d.uuid}`);

// Step 3: Thing API properties — live readings
const thingPath = `/v2.0/cloud/thing/${DEVICE_ID}/shadow/properties`;
const thingRes = await fetch(`${ENDPOINT}${thingPath}`, {
  method: "GET",
  headers: sign("GET", thingPath, "", token),
}).then((r) => r.json());

if (!thingRes.success) {
  console.error("[probe] thing properties failed:", JSON.stringify(thingRes));
  process.exit(4);
}
console.log("\n=== LIVE READINGS (Thing API) ===");
const props = thingRes.result.properties || [];
for (const p of props) {
  console.log(`  ${p.code.padEnd(20)} = ${p.value}  (type=${p.type}, dp_id=${p.dp_id}, time=${new Date(p.time).toISOString()})`);
}
console.log(`\n[probe] total properties: ${props.length}`);
