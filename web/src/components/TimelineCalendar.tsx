"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { harvestNounHe, type TimelineEvent, type TimelineEventType } from "@/lib/grow-profile";
import type { JournalEvent, JournalTone } from "@/lib/journal";

const TONE: Record<JournalTone, string> = {
  good: "var(--c-basil)",
  attention: "var(--amber)",
  bad: "var(--c-terra)",
  neutral: "var(--c-stone)",
};

const FORWARD: Record<TimelineEventType, { icon: string; label: [string, string] }> = {
  milestone: { icon: "ph-flag-pennant", label: ["Milestone", "אבן דרך"] },
  harvest: { icon: "ph-scissors", label: ["Harvest", "קטיף"] },
  prep: { icon: "ph-checklist", label: ["Prep", "הכנה"] },
  prune: { icon: "ph-scissors", label: ["Prune", "גיזום"] },
  water_change: { icon: "ph-drop", label: ["Water change", "החלפת מים"] },
  maintenance: { icon: "ph-wrench", label: ["Maintenance", "תחזוקה"] },
};

type CalEvent = {
  date: string; // YYYY-MM-DD
  forward: boolean;
  icon: string;
  color: string;
  title: string;
  detail: string | null;
};

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The grow timeline as a familiar weekly CALENDAR (weeks as rows, days as
 * columns) instead of a long list. Forward planned events show as labeled pills;
 * past journal events show as tone-colored dots. Tap a day to see its detail.
 * RTL-aware (the page's dir flips Sunday to the right in Hebrew).
 */
export function TimelineCalendar({ forward, past }: { forward: TimelineEvent[]; past: JournalEvent[] }) {
  const { t, lang } = useLang();
  const [selected, setSelected] = useState<string | null>(null);

  const events: CalEvent[] = [];
  for (const e of forward) {
    if (!e.scheduled_date) continue;
    if (e.status === "done" || e.status === "skipped" || e.status === "superseded") continue;
    const meta = FORWARD[e.type];
    const heLabel = e.type === "harvest" ? harvestNounHe(e.harvest_mode) : meta.label[1];
    events.push({
      date: e.scheduled_date,
      forward: true,
      icon: meta.icon,
      color: "var(--c-basil)",
      title: e.title || t(meta.label[0], heLabel),
      detail: e.instructions || e.note || null,
    });
  }
  for (const e of past) {
    events.push({
      date: e.ts.slice(0, 10),
      forward: false,
      icon: e.icon,
      color: TONE[e.tone],
      title: e.title,
      detail: e.detail,
    });
  }

  const todayStr = ymd(new Date());
  const allDates = events.map((e) => e.date).concat(todayStr);
  const min = allDates.reduce((a, b) => (a < b ? a : b));
  const max = allDates.reduce((a, b) => (a > b ? a : b));

  // Whole-week grid: Sunday-on/before-min → Saturday-on/after-max.
  const start = parseYmd(min);
  start.setDate(start.getDate() - start.getDay());
  const end = parseYmd(max);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const weeks: Date[][] = [];
  const cur = new Date(start);
  while (cur <= end && weeks.length < 26) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  const byDay = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const arr = byDay.get(ev.date) ?? [];
    arr.push(ev);
    byDay.set(ev.date, arr);
  }

  const weekdayLabels = lang === "he"
    ? ["א", "ב", "ג", "ד", "ה", "ו", "ש"]
    : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthName = (d: Date) => d.toLocaleDateString(lang === "he" ? "he-IL" : "en-US", { month: "short" });
  const selEvents = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 5 }}>
        {weekdayLabels.map((w, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: ".6rem", letterSpacing: ".04em", color: "var(--c-stone)" }}>{w}</div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {week.map((day) => {
              const ds = ymd(day);
              const dayEvents = byDay.get(ds) ?? [];
              const isToday = ds === todayStr;
              const inRange = ds >= min && ds <= max;
              const forwardEv = dayEvents.filter((e) => e.forward);
              const pastEv = dayEvents.filter((e) => !e.forward);
              const isSel = selected === ds;
              return (
                <button
                  key={ds}
                  type="button"
                  onClick={() => (dayEvents.length ? setSelected(isSel ? null : ds) : undefined)}
                  style={{
                    minHeight: 62,
                    border: isToday
                      ? "1px solid var(--c-basil)"
                      : "1px solid color-mix(in srgb, var(--c-parchment) 7%, transparent)",
                    borderRadius: 7,
                    background: isSel ? "var(--surface-warm)" : "transparent",
                    padding: 5,
                    textAlign: "start",
                    cursor: dayEvents.length ? "pointer" : "default",
                    opacity: inRange ? 1 : 0.3,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    font: "inherit",
                    color: "inherit",
                  }}
                >
                  <div
                    dir="ltr"
                    style={{ fontSize: ".62rem", color: isToday ? "var(--c-basil)" : "var(--c-stone)", fontWeight: isToday ? 600 : 400, fontVariantNumeric: "tabular-nums", textAlign: "start" }}
                  >
                    {day.getDate() === 1 ? `${monthName(day)} ` : ""}
                    {day.getDate()}
                  </div>

                  {forwardEv.slice(0, 1).map((e, i) => (
                    <span
                      key={"f" + i}
                      style={{ fontSize: ".55rem", color: e.color, background: `color-mix(in srgb, ${e.color} 16%, transparent)`, borderRadius: 4, padding: "1px 4px", display: "inline-flex", alignItems: "center", gap: 3, maxWidth: "100%", overflow: "hidden", whiteSpace: "nowrap" }}
                    >
                      <i className={"ph-light " + e.icon} style={{ fontSize: ".68rem", flex: "none" }} />
                      <bdi style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</bdi>
                    </span>
                  ))}

                  {pastEv.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center", marginTop: "auto" }}>
                      {pastEv.slice(0, 5).map((e, i) => (
                        <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: e.color }} />
                      ))}
                      {pastEv.length > 5 ? <span style={{ fontSize: ".5rem", color: "var(--c-stone)" }}>+{pastEv.length - 5}</span> : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selected && selEvents.length ? (
        <section className="tk-card" style={{ padding: "14px 18px", marginTop: 12 }}>
          <div dir="ltr" style={{ fontSize: ".72rem", color: "var(--c-fog)", marginBottom: 10, textAlign: "start" }}>
            {parseYmd(selected).toLocaleDateString(lang === "he" ? "he-IL" : "en-US", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {selEvents.map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <i className={"ph-light " + e.icon} style={{ color: e.color, fontSize: "1rem", marginTop: 1, flex: "none" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: ".86rem", color: "var(--c-ash)", lineHeight: 1.45 }}>
                    <bdi>{e.title}</bdi>
                    {e.forward ? <span className="by"> · {t("planned", "מתוכנן")}</span> : null}
                  </div>
                  {e.detail ? (
                    <div style={{ fontSize: ".78rem", color: "var(--c-stone)", marginTop: 2 }}><bdi>{e.detail}</bdi></div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p style={{ fontSize: ".74rem", color: "var(--c-stone)", marginTop: 10, textAlign: "center" }}>
          {t("Tap a day with a dot to see what happened.", "הקש על יום עם נקודה כדי לראות מה קרה.")}
        </p>
      )}
    </div>
  );
}
