"use client";

/**
 * Inline pending-tasks widget for the chat page.
 *
 * Sits just above the message-input row.  Surfaces up to 3 pending tasks
 * with action buttons appropriate to the task type:
 *   - dose_approval → "אשר ובצע" (fires the pump via /approve)
 *   - everything else → "בוצע" (mark done via /complete)
 *   - all types → "דחיית 1 שעה" (snooze 60m via /snooze) + "בטל" (dismiss)
 *
 * Visual states:
 *   - 0 pending → component renders nothing (no chrome)
 *   - 1 pending → single card, expanded
 *   - 2-3 pending → stack of cards
 *   - >3 pending → top 3 + a "+N נוספות" link to /state
 *
 * Polls every 15s so a cron-cycle that creates a new dose_approval shows
 * up in chat within seconds without page reload.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getTasks,
  completeTask,
  dismissTask,
  approveDoseTask,
  snoozeTask,
} from "@/lib/api";
import type { HumanTask } from "@/lib/types";

const POLL_MS = 15_000;

const PRIORITY_TONE: Record<HumanTask["priority"], { dot: string; text: string }> = {
  urgent: { dot: "bg-red-500",    text: "דחוף" },
  high:   { dot: "bg-orange-500", text: "גבוה" },
  medium: { dot: "bg-amber-500",  text: "בינוני" },
  low:    { dot: "bg-zinc-400",   text: "נמוך" },
};

const TYPE_LABEL_HE: Record<HumanTask["type"], string> = {
  dose_approval:  "אישור מנה",
  water_change:   "החלפת מים",
  manual_action:  "פעולה ידנית",
  system_reset:   "ריסט מערכת",
  question:       "שאלה",
};

export function PendingTasksCard() {
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await getTasks("pending");
      // Stable order: priority then created.  getTasks endpoint already
      // applies this server-side, but re-sort defensively.
      const sorted = [...r.tasks].sort((a, b) => {
        const order: Record<HumanTask["priority"], number> = { urgent: 0, high: 1, medium: 2, low: 3 };
        if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority];
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      setTasks(sorted);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
    const i = setInterval(load, POLL_MS);
    return () => clearInterval(i);
  }, []);

  if (err) return null;
  if (tasks.length === 0) return null;

  async function handleAction(
    taskId: number,
    action: "approve" | "complete" | "dismiss" | "snooze",
    minutes?: number
  ) {
    if (busy === taskId) return;
    setBusy(taskId);
    try {
      if (action === "approve") {
        const r = await approveDoseTask(taskId);
        if (!r.ok) {
          alert(`לא בוצע: ${r.reason || r.error || "כשל לא ידוע"}`);
        }
      } else if (action === "complete") {
        await completeTask(taskId, "marked done from chat widget");
      } else if (action === "dismiss") {
        await dismissTask(taskId, "dismissed from chat widget");
      } else {
        await snoozeTask(taskId, minutes ?? 60);
      }
      await load();
    } catch (e) {
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const visible = tasks.slice(0, 3);
  const overflow = tasks.length - visible.length;

  return (
    <div className="space-y-2 mb-2">
      {visible.map((t) => {
        const tone = PRIORITY_TONE[t.priority];
        const isApproval = t.type === "dose_approval";
        const payload = t.payload as { channel?: string; amount_ml?: number } | undefined;
        return (
          <div
            key={t.id}
            className="rounded-xl border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className={`inline-block w-2 h-2 rounded-full ${tone.dot} shrink-0`} />
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">
                  {TYPE_LABEL_HE[t.type]} · {tone.text}
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 shrink-0">#{t.id}</span>
            </div>

            <h3 className="text-sm font-medium leading-snug mb-1">{t.title}</h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed mb-2">
              {t.reason}
            </p>

            {isApproval && payload?.channel && payload?.amount_ml !== undefined && (
              <div className="mb-2 text-[11px] text-emerald-700 dark:text-emerald-300 font-mono bg-white/60 dark:bg-zinc-900/60 px-2 py-1 rounded inline-block" dir="ltr">
                {payload.channel} · {payload.amount_ml}ml
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {isApproval ? (
                <button
                  onClick={() => handleAction(t.id, "approve")}
                  disabled={busy === t.id}
                  className="text-xs px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 font-medium"
                >
                  {busy === t.id ? "..." : "אשר ובצע"}
                </button>
              ) : (
                <button
                  onClick={() => handleAction(t.id, "complete")}
                  disabled={busy === t.id}
                  className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 font-medium"
                >
                  {busy === t.id ? "..." : "בוצע"}
                </button>
              )}
              <button
                onClick={() => handleAction(t.id, "snooze", 60)}
                disabled={busy === t.id}
                className="text-xs px-2.5 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-50"
                title="הסתר את ההודעה לשעה"
              >
                ⏰ שעה
              </button>
              <button
                onClick={() => handleAction(t.id, "snooze", 60 * 6)}
                disabled={busy === t.id}
                className="text-xs px-2.5 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-50"
                title="הסתר את ההודעה ל-6 שעות"
              >
                ⏰ 6ש
              </button>
              <button
                onClick={() => handleAction(t.id, "dismiss")}
                disabled={busy === t.id}
                className="text-xs px-2.5 py-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-50 ms-auto"
              >
                בטל
              </button>
            </div>
          </div>
        );
      })}

      {overflow > 0 && (
        <Link
          href="/state"
          className="block text-center text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 py-1"
        >
          +{overflow} משימות נוספות → לוח בקרה
        </Link>
      )}
    </div>
  );
}
