"use client";

import { useState } from "react";
import { enablePush, pushSupported, pushPermission } from "@/lib/push-client";

/**
 * Inline "enable push notifications" button rendered in chat when the agent
 * emits a `requestNotificationOptIn` tool part during onboarding. Push
 * permission can only be granted from a user gesture, so the agent records the
 * preference and this button completes the grant. No-op-safe: shows a friendly
 * fallback when the browser can't do push (we still have email).
 */
export function ChatNotifyButton({ reason }: { reason?: string }) {
  const [state, setState] = useState<"idle" | "working" | "granted" | "denied" | "unsupported">(
    () => {
      if (typeof window === "undefined") return "idle";
      if (!pushSupported()) return "unsupported";
      return pushPermission() === "granted" ? "granted" : "idle";
    }
  );

  async function onEnable() {
    setState("working");
    const r = await enablePush();
    setState(r.ok ? "granted" : "denied");
  }

  return (
    <div className="bg-[var(--surface-warm)] border border-[rgba(238,237,232,0.08)] rounded-2xl p-4 my-2 max-w-md">
      {reason && <p className="text-sm leading-relaxed mb-3">{reason}</p>}
      {state === "granted" ? (
        <p className="text-sm text-emerald-500 font-medium">התראות לנייד מופעלות ✓</p>
      ) : state === "unsupported" ? (
        <p className="text-sm text-[var(--c-ash)]">
          הדפדפן הזה לא תומך בהתראות לנייד — נשלח לך התראות במייל במקום.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={onEnable}
            disabled={state === "working"}
            className="text-sm bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-60"
          >
            {state === "working" ? "מפעיל…" : "🔔 הפעל התראות לנייד"}
          </button>
          {state === "denied" && (
            <p className="text-xs text-[var(--c-ash)] mt-2">
              לא הצלחנו להפעיל — אפשר לאשר התראות בהגדרות הדפדפן, או שנסתמך על מייל.
            </p>
          )}
        </>
      )}
    </div>
  );
}
