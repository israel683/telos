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
 *   - >3 pending → top 3 + a "+N נוספות" link to the dashboard (/)
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
  answerTask,
} from "@/lib/api";
import { startVisibilityAwarePolling } from "@/lib/poll";
import type { HumanTask } from "@/lib/types";

const POLL_MS = 15_000;

// Palette-only priority dots (no rainbow): terra for urgent/high (the negative),
// amber for medium, stone for low.
const PRIORITY_TONE: Record<HumanTask["priority"], { dot: string; text: string }> = {
  urgent: { dot: "var(--c-terra)", text: "דחוף" },
  high:   { dot: "var(--c-terra)", text: "גבוה" },
  medium: { dot: "var(--amber)",   text: "בינוני" },
  low:    { dot: "var(--c-stone)", text: "נמוך" },
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
  // Per-question typed answers (a `question` task is answered, not "done").
  const [answers, setAnswers] = useState<Record<number, string>>({});

  async function submitAnswer(taskId: number) {
    const text = (answers[taskId] || "").trim();
    if (!text || busy === taskId) return;
    setBusy(taskId);
    try {
      await answerTask(taskId, text);
      setAnswers((a) => {
        const n = { ...a };
        delete n[taskId];
        return n;
      });
      await load();
    } catch (e) {
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

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
    return startVisibilityAwarePolling(load, POLL_MS);
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
        const isQuestion = t.type === "question";
        const payload = t.payload as { channel?: string; amount_ml?: number } | undefined;
        return (
          <div
            key={t.id}
            className="rounded-md border border-[rgba(137,168,62,0.25)] bg-[rgba(137,168,62,0.06)] p-3"
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: tone.dot }} />
                <span className="text-[11px] uppercase tracking-wide text-zinc-500">
                  {TYPE_LABEL_HE[t.type]} · {tone.text}
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 shrink-0">#{t.id}</span>
            </div>

            <h3 className="text-sm font-medium leading-snug mb-1 text-[var(--c-parchment)]">{t.title}</h3>
            <p className="text-xs text-[var(--c-fog)] leading-relaxed mb-2">
              {t.reason}
            </p>

            {isApproval && payload?.channel && payload?.amount_ml !== undefined && (
              <div
                className="mb-2 text-[11px] text-[var(--c-basil)] bg-[var(--c-void)] border border-[rgba(238,237,232,0.07)] px-2 py-1 rounded-sm inline-block t-num"
                dir="ltr"
              >
                {payload.channel} · {payload.amount_ml}ml
              </div>
            )}

            {/* Primary action (basil pill, per brand: ONE pill per view
                — this IS the primary action when a task surfaces).
                Secondary buttons: small radius, dim borders, terra for
                destruct (dismiss). */}
            {/* A question is ANSWERED, not "done": inline free-text input. */}
            {isQuestion && (
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={answers[t.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [t.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") submitAnswer(t.id); }}
                  placeholder="כתוב את התשובה כאן…"
                  disabled={busy === t.id}
                  className="flex-1 text-sm rounded-md px-3 py-2 text-[var(--c-parchment)] placeholder:text-[var(--c-stone)] focus:outline-none disabled:opacity-50"
                  style={{ background: "var(--c-void)", border: "1px solid rgba(238,237,232,0.12)" }}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2 sm:gap-1.5">
              {isQuestion ? (
                <button
                  onClick={() => submitAnswer(t.id)}
                  disabled={busy === t.id || !(answers[t.id] || "").trim()}
                  className="text-xs px-4 py-2.5 sm:py-1.5 rounded-full bg-[var(--c-basil)] hover:brightness-110 text-[var(--c-void)] disabled:opacity-40 font-medium tracking-wide transition-all"
                >
                  {busy === t.id ? "..." : "ענה"}
                </button>
              ) : isApproval ? (
                <button
                  onClick={() => handleAction(t.id, "approve")}
                  disabled={busy === t.id}
                  className="text-xs px-4 py-2.5 sm:py-1.5 rounded-full bg-[var(--c-basil)] hover:brightness-110 text-[var(--c-void)] disabled:opacity-50 font-medium tracking-wide transition-all"
                >
                  {busy === t.id ? "..." : "אשר ובצע"}
                </button>
              ) : (
                <button
                  onClick={() => handleAction(t.id, "complete")}
                  disabled={busy === t.id}
                  className="text-xs px-4 py-2.5 sm:py-1.5 rounded-full bg-[var(--c-mineral)] hover:brightness-125 text-[var(--c-parchment)] disabled:opacity-50 font-medium tracking-wide transition-all"
                >
                  {busy === t.id ? "..." : "בוצע"}
                </button>
              )}
              <button
                onClick={() => handleAction(t.id, "snooze", 60)}
                disabled={busy === t.id}
                className="text-xs px-2.5 py-2.5 sm:py-1.5 rounded-sm border border-[rgba(238,237,232,0.12)] text-[var(--c-fog)] hover:border-[rgba(238,237,232,0.25)] hover:bg-[var(--c-earth)] disabled:opacity-50 transition-colors"
                title="הסתר את ההודעה לשעה"
              >
                שעה
              </button>
              <button
                onClick={() => handleAction(t.id, "snooze", 60 * 6)}
                disabled={busy === t.id}
                className="text-xs px-2.5 py-2.5 sm:py-1.5 rounded-sm border border-[rgba(238,237,232,0.12)] text-[var(--c-fog)] hover:border-[rgba(238,237,232,0.25)] hover:bg-[var(--c-earth)] disabled:opacity-50 transition-colors"
                title="הסתר את ההודעה ל-6 שעות"
              >
                6 שעות
              </button>
              <button
                onClick={() => handleAction(t.id, "dismiss")}
                disabled={busy === t.id}
                className="text-xs px-2.5 py-2.5 sm:py-1.5 rounded-sm text-[var(--c-stone)] hover:text-[var(--c-terra)] hover:bg-[var(--c-earth)] disabled:opacity-50 ms-auto transition-colors"
              >
                בטל
              </button>
            </div>
          </div>
        );
      })}

      {overflow > 0 && (
        <Link
          href="/"
          className="block text-center text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 py-1"
        >
          +{overflow} משימות נוספות → לוח בקרה
        </Link>
      )}
    </div>
  );
}
