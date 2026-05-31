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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[rgba(238,237,232,0.08)] bg-[rgba(20,20,17,0.6)] p-4 sm:p-5">
      <h2 className="text-sm tracking-wide text-[var(--c-stone)] mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-3 py-1 text-sm">
      <span className="text-[var(--c-stone)] min-w-28 shrink-0">{label}</span>
      <span className="text-[var(--c-parchment)]">{value}</span>
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
    return <div className="max-w-3xl mx-auto px-4 py-10 text-[var(--c-stone)]">טוען…</div>;
  }
  if (error) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-red-400">שגיאה: {error}</div>;
  }
  if (!data) return null;

  const p = (data.grow_profile ?? {}) as Record<string, unknown>;
  const wb = p.water_baseline as { ph?: number; ec?: number } | undefined;
  const practices = (p.practices as string[] | undefined) ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4" dir="rtl">
      {/* Header — the cultivar this grow is becoming */}
      <header className="space-y-1">
        <h1 className="t-display text-2xl text-[var(--c-parchment)]">
          {data.cultivar?.name ?? data.system.crop_type}
        </h1>
        <p className="text-sm text-[var(--c-stone)]">
          {data.cultivar?.provenance ? `${data.cultivar.provenance} · ` : ""}
          {data.system.growth_stage} · {data.system.location}
        </p>
      </header>

      {/* Onboarding progress */}
      <Card title="היכרות עם הגידול">
        {data.onboarding.complete ? (
          <p className="text-sm text-[var(--c-basil)]">
            ✓ ההיכרות הושלמה — המוח האישי של הגידול הזה מגובש.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-[var(--c-fog)]">
              נותרו {data.onboarding.unanswered.length} מתוך {data.onboarding.total} שאלות.
              המוח ישאל אותן בשיחה.
            </p>
            <ul className="space-y-1">
              {data.onboarding.unanswered.map((q) => (
                <li key={q.id} className="text-sm text-[var(--c-stone)]">
                  • {q.question}
                  {q.required ? <span className="text-amber-400"> *</span> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Grow Context — the personal Brain of this grow */}
      <Card title="הקשר הגידול">
        <div className="space-y-0.5">
          <Row label="מקור מים" value={p.water_source as string} />
          <Row
            label="בסיס מים"
            value={
              wb && (wb.ph != null || wb.ec != null)
                ? [wb.ph != null ? `pH ${wb.ph}` : null, wb.ec != null ? `EC ${wb.ec}` : null]
                    .filter(Boolean)
                    .join(" · ")
                : null
            }
          />
          <Row label="תאורה" value={p.light as string} />
          <Row label="אקלים" value={p.climate as string} />
          <Row label="יעד" value={p.business_goal as string} />
          <Row label="לקוח" value={p.target_buyer as string} />
          {practices.length > 0 ? (
            <div className="pt-1">
              <span className="text-[var(--c-stone)] text-sm">פרקטיקות:</span>
              <ul className="mt-1 space-y-0.5">
                {practices.map((pr, i) => (
                  <li key={i} className="text-sm text-[var(--c-parchment)]">• {pr}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!p.water_source && !p.light && !p.business_goal && practices.length === 0 ? (
            <p className="text-sm text-[var(--c-stone)]">עדיין לא נאסף מידע — ההיכרות טרם החלה.</p>
          ) : null}
        </div>
      </Card>

      {/* Grower Memory — what the grower has taught the Brain */}
      <Card title="זיכרון המגדל">
        {data.memory.length === 0 ? (
          <p className="text-sm text-[var(--c-stone)]">המגדל עדיין לא לימד את המוח דבר על הגידול הזה.</p>
        ) : (
          <ul className="space-y-2">
            {data.memory.map((m) => (
              <li key={m.id} className="text-sm flex gap-2">
                <span className="text-[10px] uppercase tracking-wide text-[var(--c-basil)] mt-0.5 shrink-0">
                  {MEMORY_KIND_LABEL[m.kind] ?? m.kind}
                </span>
                <span className="text-[var(--c-parchment)]">{m.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Recent Episodes — the Brain's own narrative log */}
      <Card title="אפיזודות אחרונות">
        {data.episodes.length === 0 ? (
          <p className="text-sm text-[var(--c-stone)]">אין עדיין אפיזודות.</p>
        ) : (
          <ul className="space-y-2">
            {data.episodes.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-[var(--c-stone)]">
                  {e.ts.slice(0, 16).replace("T", " ")}
                  {e.status ? ` · ${STATUS_LABEL[e.status] ?? e.status}` : ""}
                </span>
                <div className="text-[var(--c-parchment)]">{e.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
