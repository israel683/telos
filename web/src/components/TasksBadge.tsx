"use client";

/**
 * Compact persistent badge that surfaces pending human tasks in the nav.
 * Splits the counts into the two categories the grower actually cares
 * about:
 *   - APPROVAL (⚡): the agronomist suggested a dose and is waiting for one
 *     click to fire the pump.  These should be acted on fast — they
 *     expire (default 30m).
 *   - HANDS    (🙋): physical-world todos (refill bottle, water change,
 *     replace sensor, calibrate).  No expiry by default; ack when done.
 *
 * Clicking the badge jumps to the dashboard (/) where the full task panel lives.
 * Refreshes every 15s so a freshly-created approval becomes visible
 * without a page reload.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getTasks } from "@/lib/api";
import { startVisibilityAwarePolling } from "@/lib/poll";
import { useLang } from "@/lib/i18n";

const POLL_MS = 15_000;

export function TasksBadge() {
  const { t } = useLang();
  const [approval, setApproval] = useState(0);
  const [hands, setHands] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const r = await getTasks("pending");
        if (stopped) return;
        const a = r.tasks.filter((t) => t.type === "dose_approval").length;
        const h = r.tasks.length - a;
        setApproval(a);
        setHands(h);
        setError(false);
      } catch {
        if (!stopped) setError(true);
      }
    }
    load();
    const stop = startVisibilityAwarePolling(load, POLL_MS);
    return () => {
      stopped = true;
      stop();
    };
  }, []);

  if (error || (approval === 0 && hands === 0)) return null;

  return (
    <Link
      href="/"
      title={`משימות ממתינות: ${approval} לאישור · ${hands} פיזי`}
      className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs px-1.5 sm:px-2 py-1 rounded-md transition-colors"
      style={{ border: "1px solid color-mix(in srgb, var(--c-parchment) 8%, transparent)", background: "var(--surface-warm)" }}
    >
      {approval > 0 && (
        <span className="flex items-center gap-1">
          <span
            className="inline-flex items-center justify-center min-w-[1.125rem] sm:min-w-[1.25rem] h-[18px] sm:h-5 px-1 rounded-full text-[10px] font-semibold leading-none"
            style={{ background: "var(--c-basil)", color: "var(--c-void)" }}
          >
            {approval}
          </span>
          <span className="hidden sm:inline" style={{ color: "var(--c-fog)" }}>{t("to approve", "לאישור")}</span>
        </span>
      )}
      {approval > 0 && hands > 0 && (
        <span className="hidden sm:inline" style={{ color: "var(--c-bark)" }}>·</span>
      )}
      {hands > 0 && (
        <span className="flex items-center gap-1">
          <span
            className="inline-flex items-center justify-center min-w-[1.125rem] sm:min-w-[1.25rem] h-[18px] sm:h-5 px-1 rounded-full text-[10px] font-semibold leading-none"
            style={{ background: "color-mix(in srgb, var(--c-mineral) 55%, var(--c-fog))", color: "var(--c-void)" }}
          >
            {hands}
          </span>
          <span className="hidden sm:inline" style={{ color: "var(--c-fog)" }}>{t("hands-on", "פיזי")}</span>
        </span>
      )}
    </Link>
  );
}
