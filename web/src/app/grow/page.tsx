"use client";

import { useEffect, useState } from "react";
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

/** A design-system card (tone, not borders; 14px soft; optional standard glow). */
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
    <section className={"tk-card" + (glow ? " glow" : "")}>
      <div className="tk-card-h">
        <span className="ct">
          {icon ? <i className={"ph-light " + icon} style={{ marginInlineEnd: 8, color: "var(--amber)" }} /> : null}
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
    <div style={{ display: "flex", gap: 12, padding: "5px 0", fontSize: ".88rem" }}>
      <span style={{ color: "var(--c-stone)", minWidth: 96, flex: "none" }}>{label}</span>
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

  if (loading) {
    return <div style={{ maxWidth: 860, margin: "0 auto", padding: "3rem 1.5rem", color: "var(--c-stone)" }}>טוען…</div>;
  }
  if (error) {
    return <div style={{ maxWidth: 860, margin: "0 auto", padding: "3rem 1.5rem", color: "var(--c-terra)" }}>שגיאה: {error}</div>;
  }
  if (!data) return null;

  const p = (data.grow_profile ?? {}) as Record<string, unknown>;
  const wb = p.water_baseline as { ph?: number; ec?: number } | undefined;
  const practices = (p.practices as string[] | undefined) ?? [];

  return (
    <div dir="rtl" style={{ maxWidth: 860, margin: "0 auto", padding: "2.5rem 1.25rem 4rem", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Hero header — the cultivar this grow is becoming. Souvenir, basil eyebrow. */}
      <header style={{ marginBottom: 6 }}>
        <span className="tk-tag">הגידול</span>
        <h1
          style={{
            fontFamily: "var(--f-display)",
            fontWeight: 300,
            fontSize: "clamp(2.1rem,5vw,3.2rem)",
            lineHeight: 1.04,
            color: "var(--c-parchment)",
            margin: ".5rem 0 .4rem",
            letterSpacing: "-.01em",
          }}
        >
          {data.cultivar?.name ?? data.system.crop_type}
        </h1>
        <p style={{ fontSize: ".82rem", letterSpacing: ".04em", color: "var(--c-stone)" }}>
          {data.cultivar?.provenance ? `${data.cultivar.provenance} · ` : ""}
          {data.system.growth_stage} · {data.system.location}
        </p>
      </header>

      {/* Onboarding */}
      <Card title="היכרות עם הגידול" icon="ph-clipboard-text" glow={!data.onboarding.complete}>
        {data.onboarding.complete ? (
          <p style={{ fontSize: ".88rem", color: "var(--c-basil)" }}>✓ ההיכרות הושלמה — המוח האישי של הגידול מגובש.</p>
        ) : (
          <>
            <p style={{ fontSize: ".85rem", color: "var(--c-fog)", marginBottom: 10 }}>
              נותרו {data.onboarding.unanswered.length} מתוך {data.onboarding.total} שאלות. המוח ישאל אותן בשיחה.
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {data.onboarding.unanswered.map((q) => (
                <li key={q.id} style={{ fontSize: ".85rem", color: "var(--c-stone)" }}>
                  • {q.question}
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
          <div style={{ paddingTop: 6 }}>
            <span style={{ color: "var(--c-stone)", fontSize: ".85rem" }}>פרקטיקות:</span>
            <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
              {practices.map((pr, i) => (
                <li key={i} style={{ fontSize: ".85rem", color: "var(--c-parchment)" }}>• {pr}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {!p.water_source && !p.light && !p.business_goal && practices.length === 0 ? (
          <p style={{ fontSize: ".85rem", color: "var(--c-stone)" }}>עדיין לא נאסף מידע — ההיכרות טרם החלה.</p>
        ) : null}
      </Card>

      {/* Grower Memory */}
      <Card title="זיכרון המגדל" icon="ph-brain">
        {data.memory.length === 0 ? (
          <p style={{ fontSize: ".85rem", color: "var(--c-stone)" }}>המגדל עדיין לא לימד את המוח דבר על הגידול הזה.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 9 }}>
            {data.memory.map((m) => (
              <li key={m.id} style={{ fontSize: ".85rem", display: "flex", gap: 9 }}>
                <span style={{ fontSize: ".58rem", letterSpacing: ".12em", textTransform: "uppercase", color: "var(--c-basil)", marginTop: 2, flex: "none" }}>
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
          <p style={{ fontSize: ".85rem", color: "var(--c-stone)" }}>אין עדיין אפיזודות.</p>
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
  );
}
