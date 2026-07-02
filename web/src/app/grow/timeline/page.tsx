"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getTimeline, type TimelineView } from "@/lib/api";
import { harvestNounHe, type TimelineEventType } from "@/lib/grow-profile";
import { useLang } from "@/lib/i18n";
import { GrowGantt } from "@/components/GrowGantt";

// Forward event-type → label + tint (mirrors the /grow spine).
const TL_TYPE: Record<TimelineEventType, { label: [string, string]; tint: string }> = {
  milestone:    { label: ["Milestone", "אבן דרך"],     tint: "var(--c-mineral)" },
  harvest:      { label: ["Harvest", "קציר"],          tint: "var(--c-basil)" },
  prep:         { label: ["Prep", "הכנה"],             tint: "var(--amber)" },
  prune:        { label: ["Prune", "גיזום"],           tint: "var(--amber)" },
  water_change: { label: ["Water change", "החלפת מים"], tint: "var(--c-mineral)" },
  maintenance:  { label: ["Maintenance", "תחזוקה"],     tint: "var(--c-stone)" },
};

/**
 * Design-verification fixture (open with ?demo=1). A realistic mid-cycle
 * lettuce grow so the roadmap can be seen/styled even on an empty local DB.
 * Never used unless explicitly requested via the query param.
 */
function demoView(): TimelineView {
  const today = new Date();
  const d = (offset: number) => {
    const x = new Date(today);
    x.setDate(x.getDate() + offset);
    return x.toISOString().slice(0, 10);
  };
  const ts = (offset: number, h = 9) => `${d(offset)}T0${h}:30:00.000Z`;
  return {
    forward: [
      { id: "harvest-next", type: "harvest", title: "", scheduled_date: d(4), window_days: 2, trigger: null, status: "planned", source: "brain", harvest_mode: "cut_and_come_again", instructions: "", note: "קטיף עלים חיצוניים", pinned: false, provenance: "demo", updated_at: ts(0) },
      { id: "water-change", type: "water_change", title: "החלפת מים", scheduled_date: d(9), window_days: 2, trigger: null, status: "planned", source: "brain", instructions: "", pinned: false, provenance: "demo", updated_at: ts(0) },
      { id: "probe-clean", type: "maintenance", title: "ניקוי חיישן", scheduled_date: null, window_days: 0, trigger: "כשמופיע רבד לבן על הפרוב", status: "planned", source: "brain", instructions: "", pinned: false, provenance: "demo", updated_at: ts(0) },
    ],
    past: [
      { id: "j1", ts: ts(-1), lane: "action", icon: "ph-drop", title: "מנת pH Down 12ml — ה-pH חזר ל-6.1", detail: null, tone: "good", by: "brain" },
      { id: "j2", ts: ts(-3), lane: "action", icon: "ph-hand", title: "מילוי מים — 3 ליטר", detail: null, tone: "neutral", by: "grower" },
      { id: "j3", ts: ts(-3, 6), lane: "task", icon: "ph-pulse", title: "טמפ' מים גבוהה — נשלחה משימה", detail: null, tone: "attention", by: "brain" },
      { id: "j4", ts: ts(-6), lane: "milestone", icon: "ph-scissors", title: "קטיף ראשון — 180 גרם", detail: null, tone: "good", by: "grower" },
      { id: "j5", ts: ts(-10), lane: "milestone", icon: "ph-flag", title: "מעבר לשלב וגטטיבי", detail: null, tone: "good", by: "brain" },
    ] as TimelineView["past"],
    grow: { anchor_date: d(-24), growth_stage: "vegetative", crop_type: "lettuce", cultivar_id: null, harvest_mode: "cut_and_come_again", harvest_cadence_days: 9 },
    windowDays: 30,
    truncated: false,
  };
}

export default function TimelinePage() {
  const { t, lang } = useLang();
  const [view, setView] = useState<TimelineView | null>(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  const load = useCallback(async (d: number) => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo")) {
      setView(demoView());
      setDemo(true);
      setLoading(false);
      return;
    }
    try {
      const v = await getTimeline(d);
      setView(v);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // On-demand: fetch when the tab opens, and again when the grower returns to it
  // (visibility), but NO background polling — a roadmap doesn't need to tick.
  useEffect(() => {
    load(days);
    const onVis = () => {
      if (document.visibilityState === "visible") load(days);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, days]);

  const dir = lang === "he" ? "rtl" : "ltr";

  const upcoming = (view?.forward ?? []).filter(
    (e) => e.status === "planned" || e.status === "due"
  );
  const past = view?.past ?? [];

  // Everything that touches the selected day — plan + journal.
  const dayDetail = useMemo(() => {
    if (!selectedDate || !view) return null;
    const plan = view.forward.filter((e) => e.scheduled_date === selectedDate);
    const journal = view.past.filter((e) => e.ts.slice(0, 10) === selectedDate);
    if (!plan.length && !journal.length) return { plan, journal, empty: true };
    return { plan, journal, empty: false };
  }, [selectedDate, view]);

  const dateFmt = new Intl.DateTimeFormat(lang === "he" ? "he-IL" : "en-GB", { day: "numeric", month: "long" });

  return (
    <div
      dir={dir}
      style={{ maxWidth: "var(--page-max)", margin: "0 auto", padding: "1.6rem clamp(0.9rem,3vw,1.6rem) 4rem", display: "flex", flexDirection: "column", gap: 16 }}
    >
      <header className="tk-rise" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--f-display)", fontWeight: 300, fontSize: "clamp(1.9rem,3.5vw,2.6rem)", color: "var(--c-parchment)", lineHeight: 1.04, letterSpacing: "-.01em" }}>
            {t("The grow roadmap", "מפת הגידול")}
          </h1>
          <p style={{ fontSize: ".95rem", color: "var(--c-ash)", marginTop: 6 }}>
            {t("The whole cycle at a glance — what was, where you are, what's ahead.", "מחזור שלם במבט אחד — מה היה, איפה אתה, ומה לפנינו.")}
          </p>
        </div>
        <Link href="/grow" className="tk-btn-ghost">{t("Back to the grow", "חזרה לגידול")}</Link>
      </header>

      {demo && (
        <p style={{ fontSize: ".72rem", color: "var(--amber)" }}>{t("Demo data (design preview)", "נתוני הדגמה (תצוגת עיצוב)")}</p>
      )}

      {loading && !view ? (
        <p style={{ color: "var(--c-ash)", fontSize: ".9rem" }}>{t("Loading the roadmap…", "טוען את מפת הגידול…")}</p>
      ) : error && !view ? (
        <section className="tk-card" style={{ padding: 22 }}>
          <p style={{ color: "var(--c-fog)", fontSize: ".92rem" }}>
            {t("Can't reach the timeline right now. It'll be back in a moment.", "לא מצליח להגיע לציר הגידול כרגע. זה יחזור עוד רגע.")}
          </p>
        </section>
      ) : (
        <>
          {/* Next up — the soonest planned action, at a glance */}
          {upcoming.length > 0
            ? (() => {
                const ev = upcoming[0];
                const label: [string, string] =
                  ev.type === "harvest" ? ["Harvest", harvestNounHe(ev.harvest_mode)] : (TL_TYPE[ev.type]?.label ?? ["", ""]);
                let when = t("when ready", "כשמוכן");
                if (ev.scheduled_date) {
                  const d = Math.ceil((new Date(`${ev.scheduled_date}T12:00:00`).getTime() - Date.now()) / 86_400_000);
                  when = d <= 0 ? t("now", "עכשיו") : d === 1 ? t("tomorrow", "מחר") : t(`in ${d} days`, `בעוד ${d} ימים`);
                }
                return (
                  <section className="tk-card glow" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <i className="ph-light ph-flag-pennant" style={{ color: "var(--c-basil)", fontSize: "1.15rem", flex: "none" }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: ".6rem", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--c-stone)" }}>{t("Next up", "הבא בתור")}</div>
                      <div style={{ fontSize: ".92rem", color: "var(--c-parchment)" }}>
                        <bdi>{ev.title || t(...label)}</bdi>
                        <span style={{ color: "var(--c-basil)", marginInlineStart: 6 }}>· {when}</span>
                        {ev.scheduled_date ? <span dir="ltr" style={{ color: "var(--c-stone)", marginInlineStart: 6 }}>{ev.scheduled_date}</span> : null}
                      </div>
                    </div>
                  </section>
                );
              })()
            : null}

          {/* The roadmap — stages, plan, journal, today. Tap a day for detail. */}
          <section className="tk-card" style={{ padding: "16px clamp(10px,3vw,18px)" }}>
            {past.length === 0 && (view?.forward ?? []).length === 0 ? (
              <p style={{ fontSize: ".88rem", color: "var(--c-ash)" }}>
                {t("No history yet for this grow.", "עדיין אין היסטוריה לגידול הזה.")}
              </p>
            ) : view ? (
              <GrowGantt view={view} selectedDate={selectedDate} onSelectDate={(d) => setSelectedDate(d === selectedDate ? null : d)} />
            ) : null}
          </section>

          {/* Selected-day detail */}
          {selectedDate && dayDetail && (
            <section className="tk-card tk-rise" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <h2 style={{ fontSize: ".95rem", color: "var(--c-parchment)", fontWeight: 600 }}>
                  {dateFmt.format(new Date(`${selectedDate}T12:00:00`))}
                </h2>
                <button className="tk-btn-ghost" style={{ fontSize: ".72rem" }} onClick={() => setSelectedDate(null)}>{t("Close", "סגור")}</button>
              </div>
              {dayDetail.empty ? (
                <p style={{ fontSize: ".85rem", color: "var(--c-stone)", marginTop: 6 }}>{t("A quiet day — nothing planned, nothing logged.", "יום שקט — אין מתוכנן ואין רישום.")}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  {dayDetail.plan.map((e) => (
                    <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: ".88rem" }}>
                      <span style={{ color: TL_TYPE[e.type]?.tint ?? "var(--c-stone)", fontSize: ".68rem", letterSpacing: ".08em", flex: "none" }}>
                        {e.type === "harvest" ? harvestNounHe(e.harvest_mode) : t(...(TL_TYPE[e.type]?.label ?? ["", ""]))}
                      </span>
                      <span style={{ color: "var(--c-fog)" }}><bdi>{e.title || e.note || ""}</bdi>{e.note && e.title ? <span style={{ color: "var(--c-ash)" }}> · {e.note}</span> : null}</span>
                    </div>
                  ))}
                  {dayDetail.journal.map((e) => (
                    <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: ".88rem" }}>
                      <i className={`ph-light ${e.icon}`} style={{ color: "var(--c-stone)", flex: "none" }} />
                      <span style={{ color: "var(--c-fog)" }}><bdi>{e.title}</bdi></span>
                      <span dir="ltr" style={{ color: "var(--c-stone)", fontSize: ".72rem", marginInlineStart: "auto" }}>
                        {new Date(e.ts).toLocaleTimeString(lang === "he" ? "he-IL" : "en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Honest window note + load-older */}
          <div style={{ textAlign: "center", color: "var(--c-stone)", fontSize: ".78rem", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <span>
              {t(`Journal window: last ${view?.windowDays ?? days} days.`, `חלון היומן: ${view?.windowDays ?? days} הימים האחרונים.`)}
            </span>
            {(view?.truncated || (view?.windowDays ?? days) < 365) && days < 365 ? (
              <button
                className="tk-btn-ghost"
                onClick={() => setDays((d) => (d < 90 ? 90 : 365))}
              >
                {t("Load older", "טען ישנים יותר")}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
