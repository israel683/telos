"use client";

import { useEffect, useState } from "react";
import { getDecisions } from "@/lib/api";
import { startVisibilityAwarePolling } from "@/lib/poll";
import type { DecisionRow, AgentStatus, DecisionInfluences } from "@/lib/types";
import { useLang, statusLabel } from "@/lib/i18n";

const STATUS_COLOR: Record<AgentStatus, string> = {
  healthy: "var(--c-basil)",
  attention: "var(--c-terra)",
  warning: "var(--c-terra)",
  critical: "var(--c-terra)",
  unknown: "var(--c-stone)",
};
/** A token-based status pill — color-mix tint so it reads on warm grounds. */
function statusPill(status: AgentStatus): React.CSSProperties {
  const c = STATUS_COLOR[status] ?? "var(--c-stone)";
  return { color: c, background: `color-mix(in srgb, ${c} 16%, transparent)` };
}

/** The "what drove this decision" panel — influences, separate from the reasoning. */
function Influences({ inp, t }: { inp: DecisionInfluences; t: (en: string, he: string) => string }) {
  const rows: Array<{ label: string; value: string }> = [];
  if (inp.trigger) rows.push({ label: t("Trigger", "טריגר"), value: inp.trigger });
  if (inp.source) rows.push({ label: t("Initiated by", "מקור"), value: inp.source });
  if (inp.current) {
    const c = inp.current;
    const parts: string[] = [];
    if (c.ph != null) parts.push(`pH ${c.ph.toFixed(2)}`);
    if (c.ec != null) parts.push(`EC ${Math.round(c.ec)}`);
    if (c.water_temp != null) parts.push(`${c.water_temp.toFixed(1)}°C`);
    rows.push({
      label: t("Reading", "קריאה"),
      value: `${parts.join(" · ") || "—"} (${Math.round(c.age_seconds / 60)}m)`,
    });
  }
  if (inp.drift) {
    const d = inp.drift;
    const parts: string[] = [];
    if (d.ph != null) parts.push(`ΔpH ${d.ph}`);
    if (d.ec != null) parts.push(`ΔEC ${d.ec}`);
    if (d.water_temp != null) parts.push(`Δ°C ${d.water_temp}`);
    if (parts.length) rows.push({ label: t("Drift since last", "שינוי מאז הקודמת"), value: parts.join(" · ") });
  }
  if (inp.bands) {
    const b = inp.bands;
    const parts: string[] = [];
    if (b.ph) parts.push(`pH [${b.ph[0]}–${b.ph[1]}]`);
    if (b.ec) parts.push(`EC [${Math.round(b.ec[0])}–${Math.round(b.ec[1])}]`);
    if (b.water_temp) parts.push(`°C [${b.water_temp[0]}–${b.water_temp[1]}]`);
    if (parts.length) rows.push({ label: t("Tolerance bands", "תחום סבילות"), value: parts.join(" · ") });
  }
  if (inp.cultivar) {
    rows.push({
      label: t("Cultivar / stage", "זן / שלב"),
      value: `${inp.cultivar.id || inp.cultivar.crop} · ${inp.cultivar.stage}`,
    });
  }
  if (inp.authority) {
    rows.push({
      label: t("Execution", "הרשאת ביצוע"),
      value: inp.authority.autonomous_dosing
        ? t("autonomous", "אוטונומי")
        : t("manual (proposals queue)", "ידני (הצעות בתור)"),
    });
  }
  if (inp.bottles_low && inp.bottles_low.length) {
    rows.push({ label: t("Low bottles", "בקבוקים נמוכים"), value: inp.bottles_low.join(", ") });
  }
  if (typeof inp.pending_tasks === "number" && inp.pending_tasks > 0) {
    rows.push({ label: t("Pending tasks", "משימות ממתינות"), value: String(inp.pending_tasks) });
  }
  if (rows.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-[var(--c-ash)] uppercase tracking-wide mb-1">
        {t("What drove this", "מה השפיע")}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-[var(--c-ash)] whitespace-nowrap">{r.label}</dt>
            <dd dir="ltr" className="text-[var(--c-fog)] dark:text-[var(--c-stone)]">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function DecisionsPage() {
  const { t } = useLang();
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    function load() {
      getDecisions(50)
        .then((r) => {
          if (!cancelled) {
            setDecisions(r.decisions);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    const stop = startVisibilityAwarePolling(load, 15_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return <main className="flex-1 grid place-items-center text-[var(--c-ash)]">{t("Loading…", "טוען...")}</main>;
  }
  // Only blank to an error when nothing has loaded; a transient poll failure
  // after we already have rows keeps the last-known list visible.
  if (error && decisions.length === 0) {
    return (
      <main className="flex-1 grid place-items-center p-8 text-center">
        <p className="text-sm text-[var(--c-ash)] max-w-sm">
          {t("Couldn't load the history right now. It'll refresh on its own.", "לא הצלחתי לטעון את ההיסטוריה כרגע. זה יתעדכן מעצמו.")}
        </p>
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto p-6">
      <header className="mb-5 tk-rise">
        <h1 style={{ fontFamily: "var(--f-display)", fontWeight: 300, fontSize: "clamp(1.9rem,3.5vw,2.6rem)", color: "var(--c-parchment)", lineHeight: 1, letterSpacing: "-.01em" }}>
          {t("Decision history", "היסטוריית החלטות")}
        </h1>
        <p className="text-sm text-[var(--c-ash)]" style={{ marginTop: 8 }}>
          {decisions.length} {t("recent analyses. Each row expands to the full detail.", "ניתוחים אחרונים. כל שורה ניתנת להרחבה לתצוגת פירוט מלאה.")}
        </p>
      </header>

      <div className="space-y-2">
        {decisions.map((d) => {
          const isOpen = expanded.has(d.id);
          const status = (d.status as AgentStatus) || "unknown";
          const concerns = (d.raw_response?.concerns || []) as string[];
          const actions = (d.raw_response?.actions || []) as Array<{
            channel: string;
            amount_ml: number;
            reason: string;
          }>;
          const tasks = (d.raw_response?.human_tasks_to_create || []) as Array<{
            type: string;
            priority: string;
            title: string;
          }>;

          return (
            <article
              key={d.id}
              className="bg-[var(--surface-warm)] rounded-lg border border-[rgba(238,237,232,0.08)] overflow-hidden"
            >
              <button
                onClick={() => toggle(d.id)}
                className="w-full text-right p-4 hover:bg-[var(--c-earth)] transition-colors"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-full" style={statusPill(status)}>
                      {statusLabel(status, t)}
                    </span>
                    <span className="text-sm text-[var(--c-ash)]" dir="ltr">
                      #{d.id} · {new Date(d.timestamp).toLocaleString("he-IL")}
                    </span>
                    {actions.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: "var(--c-basil)", background: "color-mix(in srgb, var(--c-basil) 14%, transparent)" }}>
                        {actions.length} {t("actions", "פעולות")}
                      </span>
                    )}
                    {tasks.length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: "color-mix(in srgb, var(--c-mineral) 52%, var(--lit-white))", background: "color-mix(in srgb, var(--c-mineral) 22%, transparent)" }}>
                        {tasks.length} {t("tasks", "משימות")}
                      </span>
                    )}
                  </div>
                </div>
                {d.message && (
                  <p className="mt-2 text-sm leading-relaxed font-medium">{d.message}</p>
                )}
              </button>

              {isOpen && (
                <div className="p-4 border-t border-[rgba(238,237,232,0.08)] space-y-4 bg-[var(--c-void)]">
                  {d.inputs && <Influences inp={d.inputs} t={t} />}

                  {d.analysis && (
                    <div>
                      <h3 className="text-xs font-semibold text-[var(--c-ash)] uppercase tracking-wide mb-1">
                        {t("Reasoning", "ריזונינג")}
                      </h3>
                      <p className="text-sm leading-relaxed" dir="ltr">
                        {d.analysis}
                      </p>
                    </div>
                  )}

                  {actions.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-[var(--c-ash)] uppercase tracking-wide mb-1">
                        {t("Actions", "פעולות")}
                      </h3>
                      <ul className="space-y-1.5">
                        {actions.map((a, i) => (
                          <li key={i} className="text-sm" dir="ltr">
                            <span className="font-mono bg-[var(--c-bark)] px-1.5 py-0.5 rounded text-xs">
                              {a.channel}
                            </span>{" "}
                            <span className="font-semibold">{a.amount_ml} ml</span>
                            <p className="text-xs text-[var(--c-ash)] mt-0.5">{a.reason}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {tasks.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-[var(--c-ash)] uppercase tracking-wide mb-1">
                        {t("Tasks created", "משימות שנוצרו")}
                      </h3>
                      <ul className="space-y-1.5">
                        {tasks.map((t, i) => (
                          <li key={i} className="text-sm">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--c-bark)] mr-2">
                              {t.priority}
                            </span>
                            {t.title}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {concerns.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-[var(--c-ash)] uppercase tracking-wide mb-1">
                        {t("Concerns", "דגשים")}
                      </h3>
                      <ul className="space-y-1 list-disc pr-4" dir="ltr">
                        {concerns.map((c, i) => (
                          <li key={i} className="text-sm text-[var(--c-fog)] dark:text-[var(--c-stone)]">
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}

        {decisions.length === 0 && (
          <p className="text-center py-8 text-sm text-[var(--c-ash)]">
            {t("No decisions logged yet — TELOS will record them as it watches the grow.", "עדיין אין החלטות — TELOS ירשום אותן ככל שיעקוב אחרי הגידול.")}
          </p>
        )}
      </div>
    </main>
  );
}
