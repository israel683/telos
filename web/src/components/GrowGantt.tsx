"use client";

/**
 * GrowGantt — the grow cycle as a roadmap: projected stage bands spread over
 * weeks, the plan's events (with their tolerance windows), the journal of what
 * actually happened, projected future harvests, and a glowing TODAY line.
 *
 * Time flows RTL (right = the past, left = the future) to match the app's
 * Hebrew-first reading direction. The SVG sits in an LTR scroll container for
 * predictable scrollLeft math; the RTL feel comes from the x-mapping itself.
 *
 * Honesty: stage bands are a PROJECTION (typical spans per species, anchored
 * at the grow's anchor date) and are labeled as such; projected harvests
 * render dashed. The Brain-owned timeline replaces both as it matures.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { TimelineView } from "@/lib/api";
import { harvestNounHe, type TimelineEvent } from "@/lib/grow-profile";
import type { JournalEvent } from "@/lib/journal";
import { projectStagePlan } from "@/lib/stage-plan";
import { useLang } from "@/lib/i18n";

const DAY_W = 36;
const H = 196;
const AXIS_Y = 28;
const STAGE_Y = 44;
const STAGE_H = 30;
const EVENT_Y = 108;
const JOURNAL_Y = 158;

const EVENT_TINT: Record<TimelineEvent["type"], string> = {
  milestone: "var(--c-mineral)",
  harvest: "var(--c-basil)",
  prep: "var(--amber)",
  prune: "var(--amber)",
  water_change: "var(--c-mineral)",
  maintenance: "var(--c-stone)",
};

const TONE_TINT: Record<JournalEvent["tone"], string> = {
  good: "var(--c-basil)",
  attention: "var(--c-terra)",
  bad: "var(--c-terra)",
  neutral: "var(--c-stone)",
};

/** Noon-anchored UTC day index — immune to timezone off-by-one. */
function dayIndex(iso: string, epochISO: string): number {
  return Math.round(
    (Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) - Date.parse(`${epochISO}T12:00:00Z`)) / 86_400_000
  );
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function GrowGantt({
  view,
  selectedDate,
  onSelectDate,
}: {
  view: TimelineView;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const { t, lang } = useLang();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [todayISO] = useState(() => new Date().toISOString().slice(0, 10));

  const model = useMemo(() => {
    const grow = view.grow;
    const pastDates = view.past.map((e) => e.ts.slice(0, 10)).sort();
    const anchor = grow?.anchor_date ?? pastDates[0] ?? addDays(todayISO, -14);

    // Projected stage spans, anchored at the grow anchor.
    const plan = projectStagePlan(grow?.crop_type, grow?.cultivar_id);
    let cursor = anchor;
    const stages = plan.map((s) => {
      const start = cursor;
      cursor = addDays(cursor, s.days);
      return { ...s, start, end: cursor };
    });

    // Dated forward events + projected future harvest repeats (dashed).
    const dated = view.forward.filter((e) => e.scheduled_date);
    const undated = view.forward.filter(
      (e) => !e.scheduled_date && (e.status === "planned" || e.status === "due")
    );
    const projected: Array<{ date: string; label: string }> = [];
    const cadence = grow?.harvest_cadence_days ?? null;
    const lastHarvest = dated
      .filter((e) => e.type === "harvest" && e.scheduled_date)
      .map((e) => e.scheduled_date as string)
      .sort()
      .pop();
    if (cadence && lastHarvest) {
      for (let k = 1; k <= 3; k++) projected.push({
        date: addDays(lastHarvest, cadence * k),
        label: `${harvestNounHe(grow?.harvest_mode)} ${t("(projected)", "(מוקרן)")}`,
      });
    }

    // Domain: everything visible, ~2 days of margin, capped for sanity.
    const candidates = [
      anchor,
      todayISO,
      ...pastDates,
      ...dated.map((e) => e.scheduled_date as string),
      ...projected.map((p) => p.date),
      ...(stages.length ? [stages[stages.length - 1].end] : []),
    ].sort();
    let start = addDays(candidates[0], -2);
    let end = addDays(candidates[candidates.length - 1], 7);
    if (dayIndex(end, start) < dayIndex(addDays(todayISO, 14), start)) end = addDays(todayISO, 14);
    if (dayIndex(end, start) > 150) start = addDays(end, -150); // keep the tail of long grows
    const totalDays = dayIndex(end, start) + 1;

    // Journal density per day.
    const journalByDay = new Map<string, JournalEvent[]>();
    for (const e of view.past) {
      const d = e.ts.slice(0, 10);
      journalByDay.set(d, [...(journalByDay.get(d) ?? []), e]);
    }

    return { anchor, stages, dated, undated, projected, start, end, totalDays, journalByDay };
  }, [view, todayISO, t]);

  const W = model.totalDays * DAY_W;
  // RTL time: day i (0 = domain start / the past) draws from the RIGHT edge.
  const x = (iso: string) => W - (dayIndex(iso, model.start) + 1) * DAY_W;

  // Land the initial view with today ~62% from the left — future (left side)
  // gets the majority of the viewport, a sliver of recent past for context.
  // Double-rAF: the scroll width isn't reliable until the SVG has laid out.
  useEffect(() => {
    const target = () => {
      const el = scrollRef.current;
      if (!el || el.clientWidth === 0) return;
      el.scrollLeft = Math.max(0, x(todayISO) - el.clientWidth * 0.62);
    };
    requestAnimationFrame(() => requestAnimationFrame(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.start, model.totalDays]);

  const monthFmt = new Intl.DateTimeFormat(lang === "he" ? "he-IL" : "en-GB", { month: "short" });

  // Precompute day columns once per model.
  const days = useMemo(() => {
    return Array.from({ length: model.totalDays }, (_, i) => {
      const iso = addDays(model.start, i);
      const d = new Date(`${iso}T12:00:00Z`);
      return { iso, dom: d.getUTCDate(), dow: d.getUTCDay(), monthLabel: d.getUTCDate() === 1 || i === 0 ? monthFmt.format(d) : null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.start, model.totalDays, lang]);

  return (
    <div>
      {/* Legend */}
      <div dir={lang === "he" ? "rtl" : "ltr"} style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: ".7rem", color: "var(--c-ash)", marginBottom: 10 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "color-mix(in srgb, var(--c-basil) 45%, transparent)", marginInlineEnd: 5, verticalAlign: "-1px" }} />{t("Stage (projected)", "שלב (מוקרן)")}</span>
        <span><span style={{ display: "inline-block", width: 9, height: 9, transform: "rotate(45deg)", background: "var(--c-basil)", marginInlineEnd: 6, verticalAlign: "-1px" }} />{t("Planned", "מתוכנן")}</span>
        <span><span style={{ display: "inline-block", width: 9, height: 9, transform: "rotate(45deg)", border: "1.5px dashed var(--c-ash)", marginInlineEnd: 6, verticalAlign: "-1px" }} />{t("Projected", "מוקרן")}</span>
        <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "var(--c-stone)", marginInlineEnd: 5, verticalAlign: "-1px" }} />{t("Journal", "יומן")}</span>
      </div>

      {/* dir=ltr for predictable scrollLeft; the x-mapping itself is RTL. */}
      <div ref={scrollRef} dir="ltr" style={{ overflowX: "auto", overscrollBehaviorX: "contain", WebkitOverflowScrolling: "touch", borderRadius: 12 }}>
        <svg width={W} height={H} style={{ display: "block" }} role="img" aria-label={t("Grow roadmap", "מפת הדרכים של הגידול")}>
          {/* Day grid + axis */}
          {days.map((d, i) => {
            const dx = W - (i + 1) * DAY_W;
            const isToday = d.iso === todayISO;
            const isSelected = d.iso === selectedDate;
            return (
              <g key={d.iso}>
                {d.dow === 0 && <line x1={dx + DAY_W} y1={AXIS_Y} x2={dx + DAY_W} y2={H - 8} stroke="color-mix(in srgb, var(--c-parchment) 6%, transparent)" strokeWidth={1} />}
                {isSelected && <rect x={dx} y={AXIS_Y} width={DAY_W} height={H - AXIS_Y - 8} fill="color-mix(in srgb, var(--c-parchment) 5%, transparent)" rx={6} />}
                {(i % 2 === 0 || isToday) && (
                  <text x={dx + DAY_W / 2} y={20} textAnchor="middle" fontSize={10} fill={isToday ? "var(--c-basil)" : "var(--c-stone)"} fontWeight={isToday ? 600 : 400}>
                    {d.dom}
                  </text>
                )}
                {d.monthLabel && (
                  <text x={dx + DAY_W - 4} y={8} textAnchor="end" fontSize={9} fill="var(--c-ash)" style={{ letterSpacing: ".08em" }}>
                    {d.monthLabel}
                  </text>
                )}
                {/* Tap target — full column */}
                <rect x={dx} y={0} width={DAY_W} height={H} fill="transparent" style={{ cursor: "pointer" }} onClick={() => onSelectDate(d.iso)} />
              </g>
            );
          })}

          {/* Stage bands (projection) */}
          {model.stages.map((s) => {
            const xEnd = x(s.start) + DAY_W; // RTL: start is to the RIGHT
            const xStart = x(s.end) + DAY_W;
            const w = xEnd - xStart;
            if (w <= 0) return null;
            const current = todayISO >= s.start && todayISO < s.end;
            return (
              <g key={s.stage}>
                <rect x={xStart} y={STAGE_Y} width={w} height={STAGE_H} rx={8}
                  fill={`color-mix(in srgb, ${s.tint} ${current ? 32 : 14}%, transparent)`}
                  stroke={current ? s.tint : `color-mix(in srgb, ${s.tint} 35%, transparent)`}
                  strokeWidth={current ? 1.5 : 1}
                />
                {w > 62 && (
                  <text x={xStart + w / 2} y={STAGE_Y + STAGE_H / 2 + 4} textAnchor="middle" fontSize={11}
                    fill={current ? "var(--c-parchment)" : "var(--c-ash)"} fontWeight={current ? 600 : 400}>
                    {t(...s.label)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Forward events: tolerance window + diamond */}
          {model.dated.map((e) => {
            const cx = x(e.scheduled_date as string) + DAY_W / 2;
            const tint = EVENT_TINT[e.type] ?? "var(--c-stone)";
            const done = e.status === "done";
            const win = Math.max(0, e.window_days);
            const wx = x(addDays(e.scheduled_date as string, win)) + DAY_W / 2;
            const wx2 = x(addDays(e.scheduled_date as string, -win)) + DAY_W / 2;
            return (
              <g key={e.id} opacity={e.status === "superseded" || e.status === "skipped" ? 0.35 : 1}>
                {win > 0 && <rect x={Math.min(wx, wx2)} y={EVENT_Y - 4} width={Math.abs(wx2 - wx)} height={8} rx={4} fill={`color-mix(in srgb, ${tint} 16%, transparent)`} />}
                <rect x={cx - 7} y={EVENT_Y - 7} width={14} height={14} rx={3} transform={`rotate(45 ${cx} ${EVENT_Y})`}
                  fill={done ? tint : `color-mix(in srgb, ${tint} 80%, transparent)`} stroke="var(--c-void)" strokeWidth={1.5} />
                {done && <text x={cx} y={EVENT_Y + 4} textAnchor="middle" fontSize={9} fill="var(--c-void)" fontWeight={700}>✓</text>}
              </g>
            );
          })}

          {/* Projected harvest repeats — dashed */}
          {model.projected.map((p) => {
            const cx = x(p.date) + DAY_W / 2;
            return (
              <rect key={p.date} x={cx - 6.5} y={EVENT_Y - 6.5} width={13} height={13} rx={3}
                transform={`rotate(45 ${cx} ${EVENT_Y})`} fill="transparent"
                stroke="var(--c-basil)" strokeWidth={1.4} strokeDasharray="3 2.5" opacity={0.7} />
            );
          })}

          {/* Journal dots */}
          {[...model.journalByDay.entries()].map(([iso, events]) => {
            const cx = x(iso) + DAY_W / 2;
            const tone = events.some((e) => e.tone === "bad") ? "bad" : events.some((e) => e.tone === "attention") ? "attention" : events.some((e) => e.tone === "good") ? "good" : "neutral";
            return (
              <g key={iso}>
                <circle cx={cx} cy={JOURNAL_Y} r={events.length > 1 ? 7 : 5} fill={`color-mix(in srgb, ${TONE_TINT[tone]} 75%, transparent)`} stroke="var(--c-void)" strokeWidth={1} />
                {events.length > 1 && (
                  <text x={cx} y={JOURNAL_Y + 3.5} textAnchor="middle" fontSize={9} fill="var(--c-void)" fontWeight={700}>{events.length}</text>
                )}
              </g>
            );
          })}

          {/* TODAY line — over everything */}
          {(() => {
            const cx = x(todayISO) + DAY_W / 2;
            return (
              <g>
                <line x1={cx} y1={AXIS_Y - 2} x2={cx} y2={H - 8} stroke="var(--c-basil)" strokeWidth={2} opacity={0.9} />
                <line x1={cx} y1={AXIS_Y - 2} x2={cx} y2={H - 8} stroke="var(--c-basil)" strokeWidth={7} opacity={0.14} />
                <rect x={cx - 21} y={AXIS_Y - 10} width={42} height={17} rx={8.5} fill="var(--c-basil)" />
                <text x={cx} y={AXIS_Y + 2} textAnchor="middle" fontSize={10} fill="var(--c-void)" fontWeight={700}>
                  {t("today", "היום")}
                </text>
              </g>
            );
          })()}

        </svg>
      </div>

      {/* Undated (trigger-gated) plan items — honest: no fabricated dates */}
      {model.undated.length > 0 && (
        <div dir={lang === "he" ? "rtl" : "ltr"} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {model.undated.map((e) => (
            <span key={e.id} style={{ fontSize: ".72rem", color: "var(--c-ash)", border: "1px dashed var(--c-bark)", borderRadius: 999, padding: "3px 10px" }}>
              <bdi>{e.title || t("Harvest", harvestNounHe(e.harvest_mode))}</bdi>
              {" · "}
              {e.trigger || t("when ready", "כשמוכן")}
            </span>
          ))}
        </div>
      )}

      <p dir={lang === "he" ? "rtl" : "ltr"} style={{ fontSize: ".7rem", color: "var(--c-stone)", marginTop: 10 }}>
        {t(
          "Stage bands are projected from the protocol; the Brain refines them as the grow teaches it.",
          "פסי השלבים מוקרנים מהפרוטוקול; המוח מדייק אותם ככל שהגידול מלמד אותו."
        )}
      </p>
    </div>
  );
}
