"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getGrow, answerOnboarding, type GrowView, type OnboardingView, type GrowContextField } from "@/lib/api";
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
  const pillGhost: React.CSSProperties = {
    fontSize: ".78rem",
    padding: "6px 14px",
    borderRadius: 999,
    background: "transparent",
    color: "var(--c-basil)",
    fontWeight: 500,
    border: "1px solid color-mix(in srgb, var(--c-basil) 45%, transparent)",
    cursor: "pointer",
    flex: "none",
    whiteSpace: "nowrap",
  };
  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 160,
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
        const toggle = () => { setOpenId(open ? null : q.id); setDraft(""); setErr(null); };
        return (
          <li
            key={q.id}
            style={{
              borderRadius: 10,
              border: "1px solid color-mix(in srgb, var(--c-parchment) 8%, transparent)",
              background: "var(--ground-warm)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
              <button
                onClick={toggle}
                style={{
                  flex: 1, display: "flex", alignItems: "baseline", gap: 8, textAlign: "start",
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  color: open ? "var(--c-parchment)" : "var(--c-fog)", font: "inherit",
                  fontSize: ".9rem", lineHeight: 1.5,
                }}
              >
                <span style={{ color: "var(--amber)" }}>{open ? "▾" : "•"}</span>
                <span>
                  {q.question}
                  {q.required ? <span style={{ color: "var(--amber)" }}> *</span> : null}
                </span>
              </button>
              <button onClick={toggle} style={pillGhost}>
                {open ? t("Close", "סגור") : t("Answer", "ענה")}
              </button>
            </div>

            {open && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 12px 12px" }}>
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
                      {working ? "…" : t("Save", "שמור")}
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

// Short, readable labels for the Grow Context fields (the catalog questions are
// long); keyed by onboarding question id.
const CONTEXT_LABEL: Record<string, [string, string]> = {
  water_source: ["Water source", "מקור מים"],
  water_baseline_ec: ["Water baseline EC", "בסיס מים (EC)"],
  light: ["Light", "תאורה"],
  climate: ["Climate", "אקלים"],
  business_goal: ["Goal", "יעד"],
  target_buyer: ["Buyer", "לקוח"],
  practices: ["Practices", "פרקטיקות"],
};

/**
 * One Grow Context field, editable in place. Shows the current value with an
 * "ערוך" affordance; opens a type-aware input (choice → chips, number/text →
 * field) and saves via the same /api/grow/answer endpoint (which overwrites the
 * field — practices append). This is how a grower revises an answer without
 * going through chat.
 */
function EditableField({
  field,
  onSaved,
}: {
  field: GrowContextField;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const label = CONTEXT_LABEL[field.id] ? t(...CONTEXT_LABEL[field.id]) : field.question;
  const isPractices = field.id === "practices";

  async function save(value: string) {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await answerOnboarding(field.id, v);
      setEditing(false);
      setDraft("");
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "7px 0", borderBottom: "1px solid color-mix(in srgb, var(--c-parchment) 6%, transparent)" }}>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline", fontSize: ".92rem" }}>
        <span style={{ color: "var(--c-ash)", minWidth: 104, flex: "none" }}>{label}</span>
        <span style={{ color: field.value ? "var(--c-parchment)" : "var(--c-stone)", flex: 1 }}>
          {field.value || t("not set", "לא הוגדר")}
        </span>
        {!editing ? (
          <button
            onClick={() => { setEditing(true); setDraft(""); setErr(null); }}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--c-basil)", fontSize: ".8rem", flex: "none" }}
          >
            {field.value ? t("Edit", "ערוך") : isPractices ? t("Add", "הוסף") : t("Set", "הגדר")}
          </button>
        ) : null}
      </div>

      {editing ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {field.type === "choice" && field.choices ? (
            field.choices.map((c) => (
              <button
                key={c}
                onClick={() => save(c)}
                disabled={busy}
                style={{ fontSize: ".8rem", padding: "6px 14px", borderRadius: 999, background: "var(--c-basil)", color: "var(--c-void)", border: "none", cursor: "pointer", opacity: busy ? 0.5 : 1 }}
              >
                {busy ? "…" : c}
              </button>
            ))
          ) : (
            <input
              type={field.type === "number" ? "number" : "text"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(draft); }}
              placeholder={isPractices ? t("Add a practice…", "הוסף פרקטיקה…") : t("New value…", "ערך חדש…")}
              autoFocus
              disabled={busy}
              style={{ flex: 1, minWidth: 140, fontSize: ".88rem", borderRadius: 8, padding: "7px 11px", background: "var(--c-void)", border: "1px solid color-mix(in srgb, var(--c-parchment) 12%, transparent)", color: "var(--c-parchment)" }}
            />
          )}
          {field.type !== "choice" ? (
            <button
              onClick={() => save(draft)}
              disabled={busy || !draft.trim()}
              style={{ fontSize: ".8rem", padding: "7px 16px", borderRadius: 999, background: "var(--c-basil)", color: "var(--c-void)", border: "none", cursor: "pointer", opacity: busy || !draft.trim() ? 0.45 : 1 }}
            >
              {busy ? "…" : t("Save", "שמור")}
            </button>
          ) : null}
          <button
            onClick={() => { setEditing(false); setDraft(""); setErr(null); }}
            style={{ fontSize: ".8rem", padding: "7px 12px", borderRadius: 999, background: "transparent", color: "var(--c-stone)", border: "1px solid color-mix(in srgb, var(--c-parchment) 12%, transparent)", cursor: "pointer" }}
          >
            {t("Cancel", "ביטול")}
          </button>
          {err ? <span style={{ fontSize: ".78rem", color: "var(--c-terra)" }}>{err}</span> : null}
        </div>
      ) : null}
    </div>
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
          {data.onboarding.fields.some((f) => f.answered) ? (
            <>
              {data.onboarding.fields
                .filter((f) => f.answered)
                .map((f) => (
                  <EditableField key={f.id} field={f} onSaved={load} />
                ))}
              <p style={{ fontSize: ".78rem", color: "var(--c-stone)", marginTop: 10 }}>
                {t("Tap Edit to revise what the Brain knows about this grow.", "הקש 'ערוך' כדי לעדכן מה שהמוח יודע על הגידול.")}
              </p>
            </>
          ) : (
            <p style={{ fontSize: ".9rem", color: "var(--c-ash)" }}>{t("Nothing gathered yet — onboarding hasn't started.", "עדיין לא נאסף מידע — ההיכרות טרם החלה.")}</p>
          )}
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
