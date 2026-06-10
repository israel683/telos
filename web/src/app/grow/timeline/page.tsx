"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getTimeline, type TimelineView } from "@/lib/api";
import { harvestNounHe, type TimelineEventType } from "@/lib/grow-profile";
import { useLang } from "@/lib/i18n";
import { TimelineCalendar } from "@/components/TimelineCalendar";

// Forward event-type → label + tint (mirrors the /grow spine).
const TL_TYPE: Record<TimelineEventType, { label: [string, string]; tint: string }> = {
  milestone:    { label: ["Milestone", "אבן דרך"],     tint: "var(--c-mineral)" },
  harvest:      { label: ["Harvest", "קציר"],          tint: "var(--c-basil)" },
  prep:         { label: ["Prep", "הכנה"],             tint: "var(--amber)" },
  prune:        { label: ["Prune", "גיזום"],           tint: "var(--amber)" },
  water_change: { label: ["Water change", "החלפת מים"], tint: "var(--c-mineral)" },
  maintenance:  { label: ["Maintenance", "תחזוקה"],     tint: "var(--c-stone)" },
};

export default function TimelinePage() {
  const { t, lang } = useLang();
  const [view, setView] = useState<TimelineView | null>(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (d: number) => {
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
  // (visibility), but NO background polling — a journal doesn't need to tick.
  useEffect(() => {
    load(days);
    const onVis = () => {
      if (document.visibilityState === "visible") load(days);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, days]);

  const dir = lang === "he" ? "rtl" : "ltr";

  // Forward = the plan ahead (planned / due); the soonest one is the "next up".
  const upcoming = (view?.forward ?? []).filter(
    (e) => e.status === "planned" || e.status === "due"
  );
  const past = view?.past ?? [];

  return (
    <div
      dir={dir}
      style={{ maxWidth: 860, margin: "0 auto", padding: "1.6rem clamp(0.9rem,3vw,1.6rem) 4rem", display: "flex", flexDirection: "column", gap: 16 }}
    >
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--f-display)", fontWeight: 500, fontSize: "1.6rem", color: "var(--c-parchment)" }}>
            {t("Grow timeline", "ציר הגידול")}
          </h1>
          <p style={{ fontSize: ".85rem", color: "var(--c-ash)", marginTop: 2 }}>
            {t("What's ahead, and everything that's happened to this grow.", "מה לפנינו, וכל מה שקרה לגידול הזה.")}
          </p>
        </div>
        <Link href="/grow" className="tk-btn-ghost">{t("Back to the grow", "חזרה לגידול")}</Link>
      </header>

      {loading && !view ? (
        <p style={{ color: "var(--c-ash)", fontSize: ".9rem" }}>{t("Loading the timeline…", "טוען את ציר הגידול…")}</p>
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

          {/* Calendar — weeks grid: forward pills + past dots; tap a day for detail */}
          <section className="tk-card" style={{ padding: "16px clamp(10px,3vw,18px)" }}>
            {past.length === 0 && upcoming.length === 0 ? (
              <p style={{ fontSize: ".88rem", color: "var(--c-ash)" }}>
                {t("No history yet for this grow.", "עדיין אין היסטוריה לגידול הזה.")}
              </p>
            ) : (
              <TimelineCalendar forward={view?.forward ?? []} past={past} />
            )}
          </section>

          {/* Honest window note + load-older */}
          <div style={{ textAlign: "center", color: "var(--c-stone)", fontSize: ".78rem", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <span>
              {t(`Showing the last ${view?.windowDays ?? days} days.`, `מציג את ${view?.windowDays ?? days} הימים האחרונים.`)}
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
