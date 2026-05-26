"use client";

import { useEffect, useState } from "react";
import { getActiveSystem } from "@/lib/system";
import { patchSystem } from "@/lib/api";

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
      // Soft reload so the chat history picks up the new system message
      window.location.reload();
    } catch (e) {
      window.alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  if (status === "loading") return null;
  if (status === "archived") return null;

  const isPaused = status === "paused";
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={isPaused ? "חזרה לפעולה רגילה" : "מעבר למצב תחזוקה"}
      className={`text-[11px] sm:text-xs px-1.5 sm:px-2.5 py-1 rounded-md border whitespace-nowrap transition-colors disabled:opacity-50 ${
        isPaused
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      <span aria-hidden="true">{isPaused ? "▶" : "🛠"}</span>
      {/* Hide the verbose label on mobile — the icon carries the meaning,
          and the title attribute still surfaces the long form on hover/long-press. */}
      <span className="ms-1 hidden sm:inline">
        {isPaused ? "חזור לפעולה" : "השהה"}
      </span>
    </button>
  );
}
