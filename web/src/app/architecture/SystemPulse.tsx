"use client";

/**
 * Live system pulse — admin-only panel on the architecture surface. Fetches
 * /api/admin/overview and shows each grow's lifecycle PHASE plus its last
 * decision (status, tier, source, trigger) — making the WS1–WS4 state visible.
 */
import { useEffect, useState } from "react";

type LastDecision = {
  id: number;
  ts: string;
  status: string;
  tier: string | null;
  source: string | null;
  trigger: string | null;
};
type PulseSystem = {
  id: string;
  name: string;
  status: string;
  phase: string;
  crop: string;
  stage: string;
  autonomous: boolean;
  next_check_at: string | null;
  last_decision: LastDecision | null;
};
type Overview = { systems: PulseSystem[]; tier_tally: Record<string, number> };

const PHASE_HE: Record<string, string> = {
  onboarding: "הקמה",
  establishing: "התבססות",
  growing: "גידול פעיל",
  harvest_window: "חלון קטיף",
  closed: "סגור",
};
const PHASE_COLOR: Record<string, string> = {
  onboarding: "var(--c-stone)",
  establishing: "var(--c-mineral)",
  growing: "var(--c-basil)",
  harvest_window: "var(--amber)",
  closed: "var(--c-ash)",
};

function rel(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} ד'`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} ש'`;
  return `לפני ${Math.round(h / 24)} ימים`;
}

export default function SystemPulse() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/admin/overview")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => !cancelled && (setData(j), setErr(null)))
        .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <section className="bg-[var(--surface-warm)] rounded-xl p-5 border border-[rgba(238,237,232,0.08)]">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="font-semibold">דופק מערכת (חי)</h2>
        {data && (
          <span className="text-xs text-[var(--c-stone)]" dir="ltr">
            tier · light {data.tier_tally.light ?? 0} · heavy {data.tier_tally.heavy ?? 0}
          </span>
        )}
      </div>

      {err && <p className="text-sm text-[var(--c-ash)]">לא הצלחתי לטעון כרגע ({err}).</p>}
      {!data && !err && <p className="text-sm text-[var(--c-ash)]">טוען…</p>}

      {data && data.systems.length === 0 && (
        <p className="text-sm text-[var(--c-ash)]">אין מערכות פעילות.</p>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        {data?.systems.map((s) => (
          <div key={s.id} className="rounded-lg border border-[rgba(238,237,232,0.08)] p-3 bg-[var(--c-void)]">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-sm">{s.name}</span>
              <span
                className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border"
                style={{
                  borderColor: PHASE_COLOR[s.phase] ?? "var(--c-stone)",
                  background: `color-mix(in srgb, ${PHASE_COLOR[s.phase] ?? "var(--c-stone)"} 14%, transparent)`,
                }}
              >
                {PHASE_HE[s.phase] ?? s.phase}
              </span>
            </div>
            <div className="text-xs text-[var(--c-ash)] mt-1" dir="ltr">
              {s.crop} · {s.stage} · {s.autonomous ? "autonomous" : "manual"}
            </div>
            {s.last_decision ? (
              <div className="text-xs text-[var(--c-stone)] mt-2 leading-relaxed" dir="ltr">
                <span className="font-mono">{s.last_decision.status}</span>
                {s.last_decision.tier && <> · tier <b>{s.last_decision.tier}</b></>}
                {s.last_decision.source && <> · {s.last_decision.source}</>}
                <div className="text-[var(--c-ash)] mt-0.5">
                  {rel(s.last_decision.ts)}
                  {s.last_decision.trigger ? ` — ${s.last_decision.trigger}` : ""}
                </div>
              </div>
            ) : (
              <div className="text-xs text-[var(--c-ash)] mt-2">אין החלטה עדיין</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
