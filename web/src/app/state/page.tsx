"use client";

import { useEffect, useState } from "react";
import {
  getState,
  getTasks,
  completeTask,
  dismissTask,
  approveDoseTask,
} from "@/lib/api";
import type { StateResponse, HumanTask, AgentStatus } from "@/lib/types";
import { SensorChart } from "@/components/SensorChart";
import { BottleLevels } from "@/components/BottleLevels";

const REFRESH_MS = 5_000;

const STATUS_LABEL: Record<AgentStatus, string> = {
  healthy: "תקין",
  attention: "לב",
  warning: "אזהרה",
  critical: "קריטי",
  unknown: "לא ידוע",
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  healthy: "bg-emerald-500",
  attention: "bg-amber-500",
  warning: "bg-orange-500",
  critical: "bg-red-600",
  unknown: "bg-zinc-400",
};

const PRIORITY_COLOR: Record<HumanTask["priority"], string> = {
  urgent: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-zinc-900",
  low: "bg-zinc-400 text-white",
};

const PRIORITY_LABEL: Record<HumanTask["priority"], string> = {
  urgent: "דחוף",
  high: "גבוה",
  medium: "בינוני",
  low: "נמוך",
};

const TASK_TYPE_LABEL: Record<HumanTask["type"], string> = {
  water_change: "החלפת מים",
  dose_approval: "אישור מינון",
  system_reset: "ריסט מערכת",
  question: "שאלה",
  manual_action: "פעולה ידנית",
};

export default function Dashboard() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const [s, t] = await Promise.all([getState(), getTasks("pending")]);
      setState(s);
      setTasks(t.tasks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  async function handleComplete(id: number) {
    await completeTask(id, "marked done from dashboard");
    refresh();
  }

  async function handleDismiss(id: number) {
    await dismissTask(id, "dismissed from dashboard");
    refresh();
  }

  async function handleApproveDose(id: number) {
    // dose_approval tasks need to actually FIRE the pump on approval, not
    // just flip status='done'.  The dedicated /approve endpoint handles
    // validate + execute + log + complete in one call.
    try {
      const r = await approveDoseTask(id);
      if (!r.ok) {
        const why = r.reason || r.error || "unknown failure";
        alert(`לא בוצע: ${why}`);
      }
    } catch (e) {
      alert(`שגיאה: ${e instanceof Error ? e.message : String(e)}`);
    }
    refresh();
  }

  if (loading) {
    return (
      <main className="flex-1 grid place-items-center text-zinc-500">
        טוען נתונים...
      </main>
    );
  }

  if (error || !state) {
    return (
      <main className="flex-1 grid place-items-center p-8">
        <div className="max-w-md text-center">
          <h2 className="text-xl font-semibold mb-2">שגיאת חיבור ל-Agent</h2>
          <p className="text-sm text-zinc-500 break-words">{error}</p>
          <p className="mt-4 text-xs text-zinc-400">
            ודא שהאייג&apos;נט רץ:{" "}
            <code className="bg-zinc-200 dark:bg-zinc-800 px-1 rounded">
              ./Code/dev.sh --mock
            </code>
          </p>
        </div>
      </main>
    );
  }

  const r = state.current_reading;
  const d = state.last_decision;
  const status: AgentStatus = (d?.status as AgentStatus) || "unknown";

  return (
    <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">לוח בקרה</h1>
          <p className="text-sm text-zinc-500">
            {state.system_profile.crop_type} · {state.system_profile.reservoir_liters}L · {state.system_profile.location}
            {state.agent.mock_mode && (
              <span className="mx-2 px-2 py-0.5 text-xs bg-purple-200 text-purple-900 rounded dark:bg-purple-900 dark:text-purple-200">
                MOCK
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-3 h-3 rounded-full ${STATUS_COLOR[status]}`} />
          <span className="text-sm font-medium">{STATUS_LABEL[status]}</span>
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="pH" value={r?.ph} unit="" digits={2} />
        <Metric label="EC" value={r?.ec} unit="μS/cm" digits={0} />
        <Metric label="טמפ' מים" value={r?.water_temp} unit="°C" digits={1} />
        <Metric label="ORP" value={r?.orp} unit="mV" digits={0} />
        <Metric label="TDS" value={r?.tds} unit="ppm" digits={0} />
        <Metric label="מליחות" value={r?.salinity} unit="PPM" digits={0} />
        <Metric label="S.G." value={r?.sg} unit="" digits={3} />
        <Metric label="CF" value={r?.cf} unit="" digits={2} />
      </section>

      <SensorChart />

      <BottleLevels />

      <section className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white dark:bg-zinc-900 rounded-lg p-5 shadow-sm border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">ניתוח אחרון</h2>
            <span className="text-xs text-zinc-500">
              {d ? new Date(d.timestamp).toLocaleString("he-IL") : "—"}
            </span>
          </div>
          <p className="text-sm leading-relaxed mb-3 font-medium" dir="rtl">
            {d?.message || "ממתין לניתוח ראשון..."}
          </p>
          {d?.analysis && (
            <details className="text-xs text-zinc-600 dark:text-zinc-400">
              <summary className="cursor-pointer select-none">פירוט טכני</summary>
              <p className="mt-2 leading-relaxed" dir="ltr">{d.analysis}</p>
              {d.raw_response?.concerns && (
                <ul className="mt-2 space-y-1 list-disc pr-4" dir="ltr">
                  {d.raw_response.concerns.map((c: string, i: number) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}
            </details>
          )}
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-lg p-5 shadow-sm border border-zinc-200 dark:border-zinc-800">
          <h2 className="font-semibold mb-3">מצב אייג&apos;נט</h2>
          <dl className="text-sm space-y-1.5">
            <Row label="מחזור #" value={String(state.agent.cycle_count)} />
            <Row
              label="ניתוח הבא בעוד"
              value={`${Math.round(state.agent.next_ai_seconds / 60)} דק'`}
            />
            <Row label="מודל" value={state.agent.model || "claude-sonnet-4-6"} />
            <Row label="שלב גידול" value={state.system_profile.growth_stage} />
          </dl>
        </div>
      </section>

      <TasksPanel
        tasks={tasks}
        onApprove={handleApproveDose}
        onComplete={handleComplete}
        onDismiss={handleDismiss}
      />

      <footer className="text-xs text-zinc-400 text-center pt-4">
        מתעדכן כל {REFRESH_MS / 1000} שניות
      </footer>
    </main>
  );
}

/**
 * Split pending tasks into two visually distinct buckets:
 *  - Approval-needed (dose_approval): the agent suggested a dose while
 *    the grower wasn't in the chat. One click here actually FIRES the
 *    pump (see /api/tasks/:id/approve), not just marks the task done.
 *  - Hands-needed (water_change, manual_action, system_reset, question):
 *    things only a human can do; clicking "בוצע" just records that you did it.
 */
function TasksPanel({
  tasks,
  onApprove,
  onComplete,
  onDismiss,
}: {
  tasks: HumanTask[];
  onApprove: (id: number) => void;
  onComplete: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const approval = tasks.filter((t) => t.type === "dose_approval");
  const hands = tasks.filter((t) => t.type !== "dose_approval");

  if (tasks.length === 0) {
    return (
      <section>
        <h2 className="font-semibold mb-3">משימות ממתינות</h2>
        <p className="text-sm text-zinc-500 text-center py-8 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800">
          אין משימות ממתינות. המערכת רצה אוטונומית.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      {approval.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">⚡</span>
            <h2 className="font-semibold">ממתין לאישור שלך ({approval.length})</h2>
            <span className="text-xs text-zinc-500">— לחיצה על "אשר ובצע" תפעיל את המשאבה ישירות</span>
          </div>
          <ul className="space-y-3">
            {approval.map((t) => (
              <TaskCard
                key={t.id}
                t={t}
                primaryLabel="אשר ובצע"
                primaryColor="bg-emerald-600 hover:bg-emerald-700"
                onPrimary={() => onApprove(t.id)}
                onDismiss={() => onDismiss(t.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {hands.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🙋</span>
            <h2 className="font-semibold">צריך ידיים שלך ({hands.length})</h2>
            <span className="text-xs text-zinc-500">— פעולות פיזיות / שאלות לסוכן</span>
          </div>
          <ul className="space-y-3">
            {hands.map((t) => (
              <TaskCard
                key={t.id}
                t={t}
                primaryLabel="בוצע"
                primaryColor="bg-blue-600 hover:bg-blue-700"
                onPrimary={() => onComplete(t.id)}
                onDismiss={() => onDismiss(t.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function TaskCard({
  t,
  primaryLabel,
  primaryColor,
  onPrimary,
  onDismiss,
}: {
  t: HumanTask;
  primaryLabel: string;
  primaryColor: string;
  onPrimary: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="bg-white dark:bg-zinc-900 rounded-lg p-4 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded ${PRIORITY_COLOR[t.priority]}`}>
              {PRIORITY_LABEL[t.priority]}
            </span>
            <span className="text-xs text-zinc-500">{TASK_TYPE_LABEL[t.type]}</span>
            <span className="text-xs text-zinc-400">
              #{t.id} · {new Date(t.created_at).toLocaleString("he-IL")}
            </span>
          </div>
          <h3 className="font-medium leading-snug mb-1">{t.title}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{t.reason}</p>
          {Object.keys(t.payload).length > 0 && (
            <pre
              className="mt-2 text-xs bg-zinc-100 dark:bg-zinc-800 rounded p-2 overflow-x-auto"
              dir="ltr"
            >
              {JSON.stringify(t.payload, null, 2)}
            </pre>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={onPrimary}
            className={`text-xs px-3 py-1.5 rounded text-white ${primaryColor}`}
          >
            {primaryLabel}
          </button>
          <button
            onClick={onDismiss}
            className="text-xs px-3 py-1.5 rounded bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-700 dark:hover:bg-zinc-600"
          >
            בטל
          </button>
        </div>
      </div>
    </li>
  );
}

function Metric({
  label,
  value,
  unit,
  digits,
}: {
  label: string;
  value: number | null | undefined;
  unit: string;
  digits: number;
}) {
  const display =
    value === null || value === undefined ? "—" : value.toFixed(digits);
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg p-3 shadow-sm border border-zinc-200 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1" dir="ltr">
        <span className="text-2xl font-semibold tabular-nums">{display}</span>
        {unit && <span className="text-xs text-zinc-500">{unit}</span>}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
