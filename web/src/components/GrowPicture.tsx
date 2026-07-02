"use client";

/**
 * The Grow Picture — the dashboard's opening statement.
 *
 * The grower asked the home page to "give a general picture, in words, of the
 * grow first — then descend to the graphs and details." This is that picture:
 * a plain-language read on how the grow is doing, in TELOS's voice, before any
 * dial or chart. It leads with where the cycle is (crop · stage · day N), a
 * one-glance headline of overall state, the Brain's own words as the narrative,
 * and what's coming next. Numbers appear only after the words — a small,
 * grounding strip — honoring "words first, details after".
 */

import Link from "next/link";
import { useLang, statusLabel } from "@/lib/i18n";
import { harvestNounHe } from "@/lib/grow-profile";
import type { AgentStatus, WaterReading } from "@/lib/types";
import type { TimelineEvent } from "@/lib/grow-profile";
import type { JournalEvent } from "@/lib/journal";

const DOT: Record<AgentStatus, string> = {
  healthy: "var(--c-basil)",
  attention: "var(--amber)",
  warning: "var(--c-terra)",
  critical: "var(--c-terra)",
  unknown: "var(--c-stone)",
};

export function GrowPicture({
  crop,
  stage,
  dayOfCycle,
  status,
  reading,
  message,
  analysis,
  next,
  last,
  nextWhen,
}: {
  crop: string;
  stage: string;
  dayOfCycle: number | null;
  status: AgentStatus;
  reading: WaterReading | null;
  message: string | null;
  analysis: string | null;
  next: TimelineEvent | null;
  last: JournalEvent | null;
  nextWhen: string | null;
}) {
  const { t, lang } = useLang();

  // One-glance headline — the gist in a single line, by state.
  const HEADLINE: Record<AgentStatus, [string, string]> = {
    healthy: ["Everything's steady.", "הכול יציב."],
    attention: ["Worth a look.", "שווה תשומת לב."],
    warning: ["Needs a hand.", "דורש התייחסות."],
    critical: ["Act now.", "צריך לפעול עכשיו."],
    unknown: ["Getting my bearings.", "מתמצא בנתונים."],
  };

  // The narrative in words: the Brain's own message when it has one, otherwise
  // a calm composed line so the picture is never blank.
  const narrative =
    (message && message.trim()) ||
    (reading
      ? t("The readings are in and holding.", "הקריאות התקבלו והן יציבות.")
      : t("Waiting for the first readings to come in.", "ממתין לקריאות הראשונות."));

  // Numbers, grounding the words — small and after, never leading.
  const fmt = (v: number | null | undefined, d: number) =>
    v === null || v === undefined ? null : v.toFixed(d);
  const readingBits: string[] = [];
  if (reading) {
    const ph = fmt(reading.ph, 2);
    const ec = fmt(reading.ec, 0);
    const wt = fmt(reading.water_temp, 1);
    if (ph) readingBits.push(`pH ${ph}`);
    if (ec) readingBits.push(`EC ${ec} μS/cm`);
    if (wt) readingBits.push(`${wt}°C`);
  }

  const nextTitle = next
    ? next.title || t("Harvest", harvestNounHe(next.harvest_mode))
    : null;

  const dot = DOT[status] ?? "var(--c-stone)";

  return (
    <section
      className="tk-card glow tk-rise"
      dir={lang === "he" ? "rtl" : "ltr"}
      style={{ padding: "clamp(20px,3.6vw,30px)" }}
    >
      {/* Where the cycle is — crop · stage · day N */}
      <div className="t-eyebrow" style={{ color: "var(--c-basil)" }}>
        <bdi>{crop}</bdi> · {stage}
        {dayOfCycle ? ` · ${t("day", "יום")} ${dayOfCycle}` : ""}
      </div>

      {/* Headline — overall state in words, with a status dot. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <span
          aria-hidden="true"
          style={{ width: 9, height: 9, borderRadius: "50%", background: dot, boxShadow: `0 0 0 3px ${dot}22`, flex: "none" }}
        />
        <h2
          style={{
            fontFamily: "var(--f-display)",
            fontWeight: 500,
            fontSize: "clamp(1.5rem,3vw,2.15rem)",
            color: "var(--c-parchment)",
            lineHeight: 1.15,
            letterSpacing: "-.01em",
          }}
        >
          {t(...HEADLINE[status])}
        </h2>
        <span className="sr-only">{statusLabel(status, t)}</span>
      </div>

      {/* Narrative — the picture in words (Brain's voice). */}
      <p
        style={{
          fontFamily: "var(--f-display)",
          fontStyle: "italic",
          fontWeight: 300,
          fontSize: "clamp(1.05rem,1.9vw,1.28rem)",
          lineHeight: 1.55,
          color: "var(--c-fog)",
          marginTop: 12,
        }}
      >
        {narrative}
      </p>

      {/* Numbers strip — grounding, after the words. */}
      {readingBits.length > 0 ? (
        <div dir="ltr" style={{ marginTop: 14, fontSize: ".82rem", color: "var(--c-stone)", letterSpacing: ".02em" }}>
          {readingBits.join("   ·   ")}
        </div>
      ) : null}

      {/* Technical detail — folded away; the words lead. */}
      {analysis ? (
        <details style={{ fontSize: ".8rem", color: "var(--c-ash)", marginTop: 14 }}>
          <summary style={{ cursor: "pointer", color: "var(--c-stone)", letterSpacing: ".04em" }}>
            {t("Technical detail", "פירוט טכני")}
          </summary>
          <p style={{ marginTop: 8, lineHeight: 1.6 }} dir="ltr">
            {analysis}
          </p>
        </details>
      ) : null}

      {/* What's next / recently — the plan, in a line. */}
      {next || last ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid color-mix(in srgb, var(--c-parchment) 8%, transparent)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {next ? (
            <Link
              href="/grow/timeline"
              style={{ display: "flex", alignItems: "baseline", gap: 8, textDecoration: "none", color: "inherit", flexWrap: "wrap" }}
            >
              <span style={{ color: "var(--c-stone)", fontSize: ".82rem" }}>{t("Next", "הצעד הבא")}:</span>
              <bdi style={{ color: "var(--c-parchment)", fontSize: ".95rem", fontWeight: 500 }}>{nextTitle}</bdi>
              {nextWhen ? <span style={{ color: "var(--c-basil)", fontSize: ".9rem" }}>· {nextWhen}</span> : null}
              <i
                className={"ph-light " + (lang === "he" ? "ph-arrow-left" : "ph-arrow-right")}
                style={{ color: "var(--c-stone)", fontSize: ".9rem", marginInlineStart: "auto" }}
                aria-hidden="true"
              />
            </Link>
          ) : null}
          {last ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: "var(--c-stone)", fontSize: ".82rem" }}>{t("Recently", "לאחרונה")}:</span>
              <bdi style={{ color: "var(--c-ash)", fontSize: ".9rem", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {last.title}
              </bdi>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
