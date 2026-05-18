"use client";

/**
 * Per-channel bottle-level display with predictions.
 *
 * Pulls the active system's bottle status from /api/bottle-status — that
 * endpoint runs the same getBottleStatusReport the autonomous brain sees,
 * so the dashboard, the agronomist, and the safety controller all share
 * one source of truth.
 *
 * Per channel we show: capacity → remaining bar with % indicator,
 * remaining ml, last-7-day consumption, daily average, and days until
 * empty when there's enough history.  Visual states map to
 * empty / near_empty / low / ok from the report's `level` field.
 */

import { useEffect, useState } from "react";
import { getActiveSystem } from "@/lib/system";

const POLL_MS = 30_000;

type ChannelStatus = {
  channel: string;
  capacity_ml: number | null;
  remaining_ml: number | null;
  percent_remaining: number | null;
  consumed_7d_ml: number;
  daily_avg_ml: number | null;
  days_until_empty: number | null;
  level: "ok" | "low" | "near_empty" | "empty" | "unknown";
  verified_at: string | null;
  needs_recheck: boolean;
};

type Report = {
  channels: ChannelStatus[];
  any_near_empty: boolean;
  any_needs_recheck: boolean;
  doser_verified?: boolean;
};

const LEVEL_BAR_COLOR: Record<ChannelStatus["level"], string> = {
  empty: "bg-red-600",
  near_empty: "bg-red-500",
  low: "bg-amber-500",
  ok: "bg-emerald-500",
  unknown: "bg-zinc-400",
};

const LEVEL_TEXT_COLOR: Record<ChannelStatus["level"], string> = {
  empty: "text-red-700 dark:text-red-400 font-semibold",
  near_empty: "text-red-600 dark:text-red-400 font-semibold",
  low: "text-amber-700 dark:text-amber-400",
  ok: "text-zinc-500",
  unknown: "text-zinc-400",
};

const LEVEL_TAG_HE: Record<ChannelStatus["level"], string> = {
  empty: "ריק",
  near_empty: "כמעט ריק",
  low: "נמוך",
  ok: "תקין",
  unknown: "לא ידוע",
};

function formatDays(d: number | null): string {
  if (d === null || !Number.isFinite(d)) return "—";
  if (d < 1) return "<1 יום";
  if (d < 10) return `${d.toFixed(1)} ימים`;
  return `${Math.round(d)} ימים`;
}

export function BottleLevels() {
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const sys = getActiveSystem();
        const qs = sys ? `?system=${encodeURIComponent(sys)}` : "";
        const r = await fetch(`/api/bottle-status${qs}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const j = (await r.json()) as Report;
        if (stopped) return;
        setReport(j);
        setErr(false);
      } catch {
        if (!stopped) setErr(true);
      }
    }
    load();
    const i = setInterval(load, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(i);
    };
  }, []);

  if (err || !report) return null;
  const noData = report.channels.length === 0;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg p-5 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">רמות בקבוקים</h2>
        <div className="flex items-center gap-2">
          {report.doser_verified === false && (
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
              דוזר לא מאומת
            </span>
          )}
          {report.any_near_empty && (
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300">
              צריך מילוי
            </span>
          )}
        </div>
      </div>

      {noData && (
        <p className="text-xs text-zinc-500 leading-relaxed">
          לא הוצהרו רמות. בקש בצ&apos;אט מהחקלאי לרשום כמה מל יש בכל בקבוק
          (&quot;שמתי 100 בכל אחד&quot;) — מאותו רגע אני אעקוב אחרי הירידה,
          אזהיר לפני שהבקבוק מתרוקן, ואוכל לעשות בדיקה צולבת מול מה שאתה רואה.
        </p>
      )}

      {!noData && (
        <ul className="space-y-3">
          {report.channels.map((c) => {
            const cap = c.capacity_ml;
            const rem = c.remaining_ml;
            const pct = c.percent_remaining;
            // Bar width: based on % when capacity is known, otherwise scale
            // the bar to a 200ml default so an unknown-capacity channel
            // still shows something.
            const barPct =
              pct !== null
                ? Math.max(0, Math.min(100, pct))
                : rem !== null
                ? Math.max(0, Math.min(100, (rem / 200) * 100))
                : 0;
            return (
              <li key={c.channel} className="text-sm">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="font-medium">{c.channel}</span>
                  <span className={`text-xs tabular-nums ${LEVEL_TEXT_COLOR[c.level]}`}>
                    {rem !== null ? `${rem.toFixed(1)} ml` : "—"}
                    {cap !== null ? ` / ${cap.toFixed(0)}` : ""}
                    {pct !== null ? `  (${pct.toFixed(0)}%)` : ""}
                    {c.level !== "ok" && c.level !== "unknown" && (
                      <span className="ms-1">⚠ {LEVEL_TAG_HE[c.level]}</span>
                    )}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full ${LEVEL_BAR_COLOR[c.level]} transition-all`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-zinc-500 tabular-nums">
                  <span>
                    צריכה 7 ימים: {c.consumed_7d_ml.toFixed(1)}ml
                    {c.daily_avg_ml !== null ? ` · ממוצע ${c.daily_avg_ml.toFixed(1)}ml/יום` : ""}
                  </span>
                  <span>
                    {c.days_until_empty !== null
                      ? `יספיק לעוד ${formatDays(c.days_until_empty)}`
                      : c.daily_avg_ml === null && rem !== null
                      ? "אין דאטה לתחזית"
                      : ""}
                  </span>
                </div>
                {c.needs_recheck && rem !== null && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                    🔎 לא אומת ויזואלית מעל שבוע — שווה הצצה.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
