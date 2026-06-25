/**
 * Client-side Web Push helpers — feature detection, permission, and the
 * subscribe handshake (must run from a user gesture). The VAPID PUBLIC key is
 * not secret; it ships to the client (env override or the embedded default).
 */
import { getActiveSystem } from "./system";

const VAPID_PUBLIC =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BBqYfU0hZK3eXhF9-ctWt8mPmk3G45bV5qK3n-x8nuvezbu5ftMDyeomqwkITik0Jx-qfkOV6aLvfd0-4-HWhu8";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function pushPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  // Back it with a concrete ArrayBuffer so it satisfies applicationServerKey's
  // BufferSource type (the generic Uint8Array<ArrayBufferLike> is too broad).
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Request permission + subscribe this device for the active system. Returns the
 * permission outcome so the UI can react. Idempotent (reuses an existing sub).
 */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: "denied" };
  }
  if (permission !== "granted") return { ok: false, reason: permission };

  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      }));
    const sys = getActiveSystem();
    const qs = sys && sys !== "default" ? `?system=${encodeURIComponent(sys)}` : "";
    const res = await fetch(`/api/push/subscribe${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return res.ok ? { ok: true } : { ok: false, reason: "save-failed" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "subscribe-failed" };
  }
}
