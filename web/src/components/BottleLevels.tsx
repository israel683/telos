"use client";

/**
 * Per-channel bottle-level display.
 *
 * Reads the active system's `bottle_levels` map and renders a compact
 * panel — name + ml remaining + a colour band for "fine / low / empty".
 * The dashboard places this next to the dose-history card so the grower
 * can sanity-check that the inventory matches what the autonomous loop
 * has been doing.
 *
 * Falls back to an explanatory empty state when bottle_levels is null
 * (i.e. the grower hasn't declared volumes yet via the agent's
 * `declareBottleLevels` tool).
 */

import { useEffect, useState } from "react";
import { listSystems, type SystemSummary } from "@/lib/api";
import { getActiveSystem } from "@/lib/system";

const POLL_MS = 15_000;
const FLOOR_ML = 15;       // safety controller refuses below this
const LOW_ML = 30;         // visual warning threshold

export function BottleLevels() {
  const [sys, setSys] = useState<SystemSummary | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const r = await listSystems();
        if (stopped) return;
        const active = getActiveSystem();
        setSys(r.systems.find((s) => s.id === active) ?? null);
      } catch {
        // non-fatal
      }
    }
    load();
    const i = setInterval(load, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(i);
    };
  }, []);

  if (!sys) return null;
  const levels = sys.bottle_levels ?? null;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg p-5 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">רמות בקבוקים</h2>
        {!sys.doser_verified && (
          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
            דוזר לא מאומת
          </span>
        )}
      </div>
      {!levels && (
        <p className="text-xs text-zinc-500 leading-relaxed">
          לא הוצהרו רמות. בקש בצ&apos;אט מהחקלאי לרשום כמה מל יש בכל בקבוק
          (&quot;שמתי 100 בכל אחד&quot;) — מאותו רגע אני אעקוב אחרי הירידה ואחסום
          ירייה מבקבוק ריק.
        </p>
      )}
      {levels && (
        <ul className="space-y-2">
          {Object.entries(levels).map(([ch, ml]) => {
            const tone =
              ml < FLOOR_ML ? "empty" : ml < LOW_ML ? "low" : "ok";
            const colour =
              tone === "empty"
                ? "bg-red-500"
                : tone === "low"
                ? "bg-amber-500"
                : "bg-emerald-500";
            const cap = Math.max(ml, 200); // assume 200ml bottle for the bar's max
            const pct = Math.min(100, Math.max(0, (ml / cap) * 100));
            return (
              <li key={ch} className="text-sm">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="font-medium">{ch}</span>
                  <span
                    className={`text-xs tabular-nums ${
                      tone === "empty"
                        ? "text-red-600 dark:text-red-400 font-semibold"
                        : tone === "low"
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-zinc-500"
                    }`}
                  >
                    {ml.toFixed(1)} ml
                    {tone === "empty" && " ⚠ ריק"}
                    {tone === "low" && " — נמוך"}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full ${colour} transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
