"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getGrow, type GrowView } from "@/lib/api";

const REFRESH_MS = 15_000;

const MEMORY_KIND_LABEL: Record<string, string> = {
  fact: "עובדה",
  correction: "תיקון",
  preference: "העדפה",
  observation: "תצפית",
};

const STATUS_LABEL: Record<string, string> = {
  healthy: "תקין",
  attention: "לב",
  warning: "אזהרה",
  critical: "קריטי",
};

const STAGE_LABEL: Record<string, string> = {
  seedling: "שתיל",
  vegetative: "וגטטיבי",
  flowering: "פריחה",
  fruiting: "פרי",
};

/** Design-system card — lifts by tone, 14px soft, optional Standard glow. */
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

export default function GrowPage() {
  const [data, setData] = useState<GrowView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const g = await getGrow();
        if (alive) {
          setData(g);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (loading) return <div style={{ maxWidth: 1180, margin: "0 auto", padding: "3rem 1.5rem", color: "var(--c-ash)" }}>טוען…</div>;
  if (error) return <div style={{ maxWidth: 1180, margin: "0 auto", padding: "3rem 1.5rem", color: "var(--c-terra)" }}>שגיאה: {error}</div>;
  if (!data) return null;

  const p = (data.grow_profile ?? {}) as Record<string, unknown>;
  const wb = p.water_baseline as { ph?: number; ec?: number } | undefined;
  const practices = (p.practices as string[] | undefined) ?? [];
  const stage = STAGE_LABEL[data.system.growth_stage] ?? data.system.growth_stage;
  const answered = data.onboarding.total - data.onboarding.unanswered.length;
  const latestEpisode = data.episodes[0]?.summary;

  return (
    <div dir="rtl" style={{ maxWidth: 1180, margin: "0 auto", padding: "1.6rem clamp(0.9rem,3vw,1.6rem) 4rem", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── HERO — cinematic image + spotlit statement (Focus moment) ── */}
      <section className="tk-focus">
        <div className="tk-focus-visual">
          {/* eslint-disable-next-line @next/next/no-img-element -- cinematic hero, object-fit cover; swap with a real cultivar render */}
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
          <div className="day">שלב {stage}{data.onboarding.complete ? " · המוח האישי מגובש" : " · בהיכרות"}</div>
          <h1>{data.cultivar?.name ?? data.system.crop_type}</h1>
          <div className="note">
            {latestEpisode ?? "עדיין אוסף את התמונה המלאה של הגידול. ככל שתלמד אותי, ארקום את המוח האישי שלו."}
            <span className="by">— המוח</span>
          </div>
          <div className="tk-focus-stats">
            <div className="tk-fs"><div className="v">{answered}/{data.onboarding.total}</div><div className="l">היכרות</div></div>
            <div className="tk-fs"><div className="v">{data.memory.length}</div><div className="l">דברים שלמדתי</div></div>
            <div className="tk-fs"><div className="v">{stage}</div><div className="l">שלב גידול</div></div>
          </div>
          <div className="tk-focus-actions">
            <Link href="/" className="tk-btn">פתח שיחה <span aria-hidden="true">→</span></Link>
            <Link href="/decisions" className="tk-btn-ghost">ההחלטות</Link>
          </div>
        </div>
      </section>

      {/* ── supporting cards — tablet 2-up ── */}
      <div className="tk-grid-2">
        {/* Onboarding */}
        <Card title="היכרות עם הגידול" icon="ph-clipboard-text" glow={!data.onboarding.complete}>
          {data.onboarding.complete ? (
            <p style={{ fontSize: ".92rem", color: "var(--c-basil)" }}>✓ ההיכרות הושלמה — המוח האישי של הגידול מגובש.</p>
          ) : (
            <>
              <p style={{ fontSize: ".9rem", color: "var(--c-fog)", marginBottom: 12 }}>
                נותרו {data.onboarding.unanswered.length} מתוך {data.onboarding.total} שאלות. המוח ישאל אותן בשיחה.
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {data.onboarding.unanswered.map((q) => (
                  <li key={q.id} style={{ fontSize: ".9rem", color: "var(--c-fog)", lineHeight: 1.5 }}>
                    <span style={{ color: "var(--amber)" }}>•</span> {q.question}
                    {q.required ? <span style={{ color: "var(--amber)" }}> *</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* Grow Context */}
        <Card title="הקשר הגידול" icon="ph-plant">
          <Field label="מקור מים" value={p.water_source as string} />
          <Field
            label="בסיס מים"
            value={
              wb && (wb.ph != null || wb.ec != null)
                ? [wb.ph != null ? `pH ${wb.ph}` : null, wb.ec != null ? `EC ${wb.ec}` : null].filter(Boolean).join(" · ")
                : null
            }
          />
          <Field label="תאורה" value={p.light as string} />
          <Field label="אקלים" value={p.climate as string} />
          <Field label="יעד" value={p.business_goal as string} />
          <Field label="לקוח" value={p.target_buyer as string} />
          {practices.length > 0 ? (
            <div style={{ paddingTop: 10 }}>
              <span style={{ color: "var(--c-ash)", fontSize: ".88rem" }}>פרקטיקות:</span>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
                {practices.map((pr, i) => (
                  <li key={i} style={{ fontSize: ".9rem", color: "var(--c-parchment)" }}>• {pr}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!p.water_source && !p.light && !p.business_goal && practices.length === 0 ? (
            <p style={{ fontSize: ".9rem", color: "var(--c-ash)" }}>עדיין לא נאסף מידע — ההיכרות טרם החלה.</p>
          ) : null}
        </Card>

        {/* Grower Memory */}
        <Card title="זיכרון המגדל" icon="ph-brain">
          {data.memory.length === 0 ? (
            <p style={{ fontSize: ".9rem", color: "var(--c-ash)" }}>המגדל עדיין לא לימד את המוח דבר על הגידול הזה.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 11 }}>
              {data.memory.map((m) => (
                <li key={m.id} style={{ fontSize: ".9rem", display: "flex", gap: 10, lineHeight: 1.5 }}>
                  <span style={{ fontSize: ".56rem", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--c-basil)", marginTop: 3, flex: "none", minWidth: 42 }}>
                    {MEMORY_KIND_LABEL[m.kind] ?? m.kind}
                  </span>
                  <span style={{ color: "var(--c-parchment)" }}>{m.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent Episodes */}
        <Card title="אפיזודות אחרונות" icon="ph-pulse">
          {data.episodes.length === 0 ? (
            <p style={{ fontSize: ".9rem", color: "var(--c-ash)" }}>אין עדיין אפיזודות.</p>
          ) : (
            <div>
              {data.episodes.map((e) => (
                <div className="tk-le" key={e.id}>
                  <span className="lt">{e.ts.slice(5, 16).replace("T", " ")}</span>
                  <span className="lx">
                    {e.status ? <b>{STATUS_LABEL[e.status] ?? e.status} · </b> : null}
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
