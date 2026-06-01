"use client";

import { useEffect, useState } from "react";
import { getActiveSystem } from "@/lib/system";
import { patchSystem } from "@/lib/api";

/**
 * Pause / resume the system (maintenance mode). Rendered as a row inside the
 * nav overflow menu — an icon + label, palette-correct. When paused the agent
 * stops taking autonomous decisions until resumed.
 */
export function MaintenanceToggle() {
  const [status, setStatus] = useState<"active" | "paused" | "archived" | "loading">("loading");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const sys = getActiveSystem();
      const qs = sys && sys !== "default" ? `?system=${encodeURIComponent(sys)}` : "";
      const r = await fetch(`/api/state${qs}`, { cache: "no-store" });
      const j = await r.json();
      setStatus(j.system?.status ?? "active");
    } catch {
      setStatus("active");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle() {
    if (busy || status === "loading" || status === "archived") return;
    const next = status === "paused" ? "active" : "paused";
    const confirmText =
      next === "paused"
        ? "להעביר את המערכת לתחזוקה? האייג'נט יפסיק לקבל החלטות אוטונומיות עד שתשחרר."
        : "לחזור לפעולה רגילה? האייג'נט יחזור לקבל החלטות ויבקש ממך לסכם מה שינית.";
    if (!window.confirm(confirmText)) return;

    setBusy(true);
    try {
      const sys = getActiveSystem();
      await patchSystem(sys, { status: next });
      setStatus(next);
      window.location.reload();
    } catch (e) {
      window.alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  if (status === "loading" || status === "archived") return null;

  const isPaused = status === "paused";
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-right disabled:opacity-50"
      style={{ color: isPaused ? "var(--c-basil)" : "var(--c-fog)" }}
    >
      <i className={"ph-light " + (isPaused ? "ph-play" : "ph-pause")} style={{ fontSize: "1.05rem", color: isPaused ? "var(--c-basil)" : "var(--amber)" }} />
      {isPaused ? "חזרה לפעולה" : "השהיית המערכת"}
    </button>
  );
}
