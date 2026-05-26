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
 * Clicking the badge jumps to /state where the full task panel lives.
 * Refreshes every 15s so a freshly-created approval becomes visible
 * without a page reload.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getTasks } from "@/lib/api";

const POLL_MS = 15_000;

export function TasksBadge() {
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
    const i = setInterval(load, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(i);
    };
  }, []);

  if (error || (approval === 0 && hands === 0)) return null;

  return (
    <Link
      href="/state"
      title={`משימות ממתינות: ${approval} לאישור · ${hands} פיזי`}
      className="flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs px-1.5 sm:px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800"
    >
      {approval > 0 && (
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center justify-center min-w-[1.125rem] sm:min-w-[1.25rem] h-[18px] sm:h-5 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-semibold leading-none">
            {approval}
          </span>
          {/* Hide the word "לאישור" on mobile — the green pill colour
              already signals "approval needed" and saves horizontal space. */}
          <span className="text-zinc-700 dark:text-zinc-300 hidden sm:inline">לאישור</span>
        </span>
      )}
      {approval > 0 && hands > 0 && (
        <span className="text-zinc-300 dark:text-zinc-700 hidden sm:inline">·</span>
      )}
      {hands > 0 && (
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center justify-center min-w-[1.125rem] sm:min-w-[1.25rem] h-[18px] sm:h-5 px-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold leading-none">
            {hands}
          </span>
          <span className="text-zinc-700 dark:text-zinc-300 hidden sm:inline">פיזי</span>
        </span>
      )}
    </Link>
  );
}
