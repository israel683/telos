"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getGrow, answerOnboarding, type GrowView, type OnboardingView } from "@/lib/api";
import { startVisibilityAwarePolling } from "@/lib/poll";
import { useLang, statusLabel } from "@/lib/i18n";

const REFRESH_MS = 15_000;

const MEMORY_KIND: Record<string, [string, string]> = {
  fact: ["fact", "עובדה"],
  correction: ["correction", "תיקון"],
  preference: ["preference", "העדפה"],
  observation: ["observation", "תצפית"],
};
const STAGE: Record<string, [string, string]> = {
  seedling: ["seedling", "שתיל"],
  vegetative: ["vegetative", "וגטטיבי"],
  flowering: ["flowering", "פריחה"],
  fruiting: ["fruiting", "פרי"],
};

function Card({
  title,
  icon,
  glow,
  children,
}: {
  title: string;
  icon?: string;
  glow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={"tk-card" + (glow ? " glow" : "")} style={{ padding: 22 }}>
      <div className="tk-card-h">
        <span className="ct" style={{ color: "var(--c-fog)", display: "flex", alignItems: "center", gap: 8 }}>
          {icon ? <i className={"ph-light " + icon} style={{ color: "var(--amber)", fontSize: "1rem" }} /> : null}
          {title}
        </span>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div style={{ display: "flex", gap: 14, padding: "7px 0", fontSize: ".92rem", borderBottom: "1px solid color-mix(in srgb, var(--c-parchment) 6%, transparent)" }}>
      <span style={{ color: "var(--c-ash)", minWidth: 104, flex: "none" }}>{label}</span>
      <span style={{ color: "var(--c-parchment)" }}>{value}</span>
    </div>
  );
}

/**
 * The unanswered onboarding questions, answerable inline. The Brain asks these
 * in the chat kickoff for a fresh system — but a grower who joined mid-way (or
 * skipped) never got asked, so each question is clickable here: tap it to open
 * an input (choice → chips, number → numeric, text → free text), answer, and it
 * merges straight into grow_profile. `onAnswered` refetches the Grow view.
 */
function OnboardingChecklist({
  unanswered,
  onAnswered,
}: {
  unanswered: OnboardingView["unanswered"];
  onAnswered: () => void | Promise<void>;
}) {
  const { t } = useLang();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(id: string, value: string) {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(id);
    setErr(null);
    try {
      await answerOnboarding(id, v);
      setOpenId(null);
      setDraft("");
      await onAnswered();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const pill: React.CSSProperties = {
    fontSize: ".8rem",
    padding: "8px 16px",
    borderRadius: 999,
    background: "var(--c-basil)",
    color: "var(--c-void)",
    fontWeight: 500,
    border: "none",
    cursor: "pointer",
  };
  const inputStyle: React.CSSProperties = {
    flex: 1,
    fontSize: ".9rem",
    borderRadius: 8,
    padding: "8px 12px",
    background: "var(--c-void)",
    border: "1px solid color-mix(in srgb, var(--c-parchment) 12%, transparent)",
    color: "var(--c-parchment)",
  };

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {unanswered.map((q) => {
        const open = openId === q.id;
        const working = busy === q.id;
        return (
          <li key={q.id} style={{ fontSize: ".9rem", color: "var(--c-fog)", lineHeight: 1.5 }}>
            <button
              onClick={() => { setOpenId(open ? null : q.id); setDraft(""); setErr(null); }}
              style={{
                display: "flex", alignItems: "baseline", gap: 8, width: "100%", textAlign: "start",
                background: "none", border: "none", padding: 0, cursor: "pointer",
                color: open ? "var(--c-parchment)" : "var(--c-fog)", font: "inherit",
              }}
            >
              <span style={{ color: "var(--amber)" }}>{open ? "▾" : "•"}</span>
              <span>
                {q.question}
                {q.required ? <span style={{ color: "var(--amber)" }}> *</span> : null}
              </span>
            </button>

            {open && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8, paddingInlineStart: 16 }}>
                {q.type === "choice" && q.choices ? (
                  q.choices.map((c) => (
                    <button key={c} onClick={() => submit(q.id, c)} disabled={working} style={{ ...pill, opacity: working ? 0.5 : 1 }}>
                      {working ? "…" : c}
                    </button>
                  ))
                ) : (
                  <>
                    <input
                      type={q.type === "number" ? "number" : "text"}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submit(q.id, draft); }}
                      placeholder={t("Type your answer…", "כתוב את התשובה כאן…")}
                      autoFocus
                      disabled={working}
                      style={inputStyle}
                    />
                    <button onClick={() => submit(q.id, draft)} disabled={working || !draft.trim()} style={{ ...pill, opacity: working || !draft.trim() ? 0.45 : 1 }}>
                      {working ? "…" : t("Answer", "ענה")}
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
      {err ? <li style={{ fontSize: ".82rem", color: "var(--c-terra)" }}>{t("Error", "שגיאה")}: {err}</li> : null}
    </ul>
  );
}

export default function GrowPage() {
  const { t, lang } = useLang();
  const [data, setData] = useState<GrowView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const g = await getGrow();
      setData(g);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return startVisibilityAwarePolling(load, REFRESH_MS);
  }, [load]);

  if (loading) return <div style={{ maxWidth: 1180, margin: "0 auto", padding: "3rem 1.5rem", color: "var(--c-ash)" }}>{t("Loading…", "טוען…")}</div>;
  if (error) return <div style={{ maxWidth: 1180, margin: "0 auto", padding: "3rem 1.5rem", color: "var(--c-terra)" }}>{t("Error", "שגיאה")}: {error}</div>;
  if (!data) return null;

  const p = (data.grow_profile ?? {}) as Record<string, unknown>;
  const wb = p.water_baseline as { ph?: number; ec?: number } | undefined;
  const practices = (p.practices as string[] | undefined) ?? [];
  const stagePair = STAGE[data.system.growth_stage];
  const stage = stagePair ? t(stagePair[0], stagePair[1]) : data.system.growth_stage;
  const answered = data.onboarding.total - data.onboarding.unanswered.length;
  const latestEpisode = data.episodes[0]?.summary;

  return (
    <div dir={lang === "he" ? "rtl" : "ltr"} style={{ maxWidth: 1180, margin: "0 auto", padding: "1.6rem clamp(0.9rem,3vw,1.6rem) 4rem", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* HERO — cinematic image + spotlit statement */}
      <section className="tk-focus">
        <div className="tk-focus-visual">
          {/* eslint-disable-next-line @next/next/no-img-element -- cinematic hero */}
          <img src="/brand/founding-basil.png" alt={data.cultivar?.name ?? data.system.crop_type} />
          <div className="grad" />
          <div className="dust" />
          <div className="vtag">
            <span className="tk-tag" style={{ background: "color-mix(in srgb, var(--c-void) 45%, transparent)", backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)", padding: "6px 11px", borderRadius: 5, letterSpacing: ".18em" }}>
              {data.cultivar?.provenance ? `${data.cultivar.provenance} · ` : ""}{data.system.location}
            </span>
          </div>
        </div>
        <div className="tk-focus-body">
          <div className="day">{t("Stage", "שלב")} {stage}{data.onboarding.complete ? t(" · personal Brain established", " · המוח האישי מגובש") : t(" · in onboarding", " · בהיכרות")}</div>
          <h1>{data.cultivar?.name ?? data.system.crop_type}</h1>
          <div className="note">
            {latestEpisode ?? t("Still gathering the full picture of this grow. The more you teach me, the sharper its personal Brain.", "עדיין אוסף את התמונה המלאה של הגידול. ככל שתלמד אותי, ארקום את המוח האישי שלו.")}
            <span className="by">— {t("The Brain", "המוח")}</span>
          </div>
          <div className="tk-focus-stats">
            <div className="tk-fs"><div className="v">{answered}/{data.onboarding.total}</div><div className="l">{t("onboarding", "היכרות")}</div></div>
            <div className="tk-fs"><div className="v">{data.memory.length}</div><div className="l">{t("things learned", "דברים שלמדתי")}</div></div>
            <div className="tk-fs"><div className="v">{stage}</div><div className="l">{t("growth stage", "שלב גידול")}</div></div>
          </div>
          <div className="tk-focus-actions">
            <Link href="/chat" className="tk-btn">{t("Open chat", "פתח שיחה")} <span aria-hidden="true">→</span></Link>
            <Link href="/decisions" className="tk-btn-ghost">{t("Decisions", "ההחלטות")}</Link>
          </div>
        </div>
      </section>

      <div className="tk-grid-2">
        <Card title={t("Getting to know the grow", "היכרות עם הגידול")} icon="ph-clipboard-text" glow={!data.onboarding.complete}>
          {data.onboarding.complete ? (
            <p style={{ fontSize: ".92rem", color: "var(--c-basil)" }}>✓ {t("Onboarding complete — the grow's personal Brain is established.", "ההיכרות הושלמה — המוח האישי של הגידול מגובש.")}</p>
          ) : (
            <>
              <p style={{ fontSize: ".9rem", color: "var(--c-fog)", marginBottom: 12 }}>
                {t(`${data.onboarding.unanswered.length} of ${data.onboarding.total} questions left. Tap a question to answer it here, or the Brain will ask in chat.`, `נותרו ${data.onboarding.unanswered.length} מתוך ${data.onboarding.total} שאלות. הקש על שאלה כדי לענות כאן, או שהמוח ישאל בשיחה.`)}
              </p>
              <OnboardingChecklist unanswered={data.onboarding.unanswered} onAnswered={load} />
            </>
          )}
        </Card>

        <Card title={t("Grow context", "הקשר הגידול")} icon="ph-plant">
          <Field label={t("Water source", "מקור מים")} value={p.water_source as string} />
          <Field
            label={t("Water baseline", "בסיס מים")}
            value={
              wb && (wb.ph != null || wb.ec != null)
                ? [wb.ph != null ? `pH ${wb.ph}` : null, wb.ec != null ? `EC ${wb.ec}` : null].filter(Boolean).join(" · ")
                : null
            }
          />
          <Field label={t("Light", "תאורה")} value={p.light as string} />
          <Field label={t("Climate", "אקלים")} value={p.climate as string} />
          <Field label={t("Goal", "יעד")} value={p.business_goal as string} />
          <Field label={t("Buyer", "לקוח")} value={p.target_buyer as string} />
          {practices.length > 0 ? (
            <div style={{ paddingTop: 10 }}>
              <span style={{ color: "var(--c-ash)", fontSize: ".88rem" }}>{t("Practices:", "פרקטיקות:")}</span>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
                {practices.map((pr, i) => (
                  <li key={i} style={{ fontSize: ".9rem", color: "var(--c-parchment)" }}>• {pr}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!p.water_source && !p.light && !p.business_goal && practices.length === 0 ? (
            <p style={{ fontSize: ".9rem", color: "var(--c-ash)" }}>{t("Nothing gathered yet — onboarding hasn't started.", "עדיין לא נאסף מידע — ההיכרות טרם החלה.")}</p>
          ) : null}
        </Card>

        <Card title={t("Grower memory", "זיכרון המגדל")} icon="ph-brain">
          {data.memory.length === 0 ? (
            <p style={{ fontSize: ".9rem", color: "var(--c-ash)" }}>{t("The grower hasn't taught the Brain anything about this grow yet.", "המגדל עדיין לא לימד את המוח דבר על הגידול הזה.")}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 11 }}>
              {data.memory.map((m) => {
                const kp = MEMORY_KIND[m.kind];
                return (
                  <li key={m.id} style={{ fontSize: ".9rem", display: "flex", gap: 10, lineHeight: 1.5 }}>
                    <span style={{ fontSize: ".56rem", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--c-basil)", marginTop: 3, flex: "none", minWidth: 42 }}>
                      {kp ? t(kp[0], kp[1]) : m.kind}
                    </span>
                    <span style={{ color: "var(--c-parchment)" }}>{m.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={t("Recent episodes", "אפיזודות אחרונות")} icon="ph-pulse">
          {data.episodes.length === 0 ? (
            <p style={{ fontSize: ".9rem", color: "var(--c-ash)" }}>{t("No episodes yet.", "אין עדיין אפיזודות.")}</p>
          ) : (
            <div>
              {data.episodes.map((e) => (
                <div className="tk-le" key={e.id}>
                  <span className="lt">{e.ts.slice(5, 16).replace("T", " ")}</span>
                  <span className="lx">
                    {e.status ? <b>{statusLabel(e.status, t)} · </b> : null}
                    {e.summary}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
