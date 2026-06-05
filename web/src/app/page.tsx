"use client";

import { useEffect, useState } from "react";
import {
  getState,
  getTasks,
  completeTask,
  dismissTask,
  approveDoseTask,
  answerTask,
} from "@/lib/api";
import type { StateResponse, HumanTask, AgentStatus } from "@/lib/types";
import { SensorChart } from "@/components/SensorChart";
import { BottleLevels } from "@/components/BottleLevels";
import { startVisibilityAwarePolling } from "@/lib/poll";
import { useLang, statusLabel } from "@/lib/i18n";

// Sensor data lands at most every few minutes (the poll cron), so a tight
// dashboard refresh just re-queries the same rows and wakes Neon for nothing.
const REFRESH_MS = 10_000;

const STATUS_DOT: Record<AgentStatus, string> = {
  healthy: "var(--c-basil)", attention: "var(--c-terra)", warning: "var(--c-terra)",
  critical: "var(--c-terra)", unknown: "var(--c-stone)",
};
const PRIORITY_LABEL: Record<HumanTask["priority"], [string, string]> = {
  urgent: ["Urgent", "דחוף"], high: ["High", "גבוה"], medium: ["Medium", "בינוני"], low: ["Low", "נמוך"],
};
const TASK_TYPE_LABEL: Record<HumanTask["type"], [string, string]> = {
  water_change: ["Water change", "החלפת מים"], dose_approval: ["Dose approval", "אישור מינון"],
  system_reset: ["System reset", "ריסט מערכת"], question: ["Question", "שאלה"], manual_action: ["Manual action", "פעולה ידנית"],
};
const STAGE_LABEL: Record<string, [string, string]> = {
  seedling: ["seedling", "שתיל"], vegetative: ["vegetative", "וגטטיבי"], flowering: ["flowering", "פריחה"], fruiting: ["fruiting", "פרי"],
};

export default function Dashboard() {
  const { t, lang } = useLang();
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
    return startVisibilityAwarePolling(refresh, REFRESH_MS);
  }, []);

  async function handleComplete(id: number) { await completeTask(id, "marked done from dashboard"); refresh(); }
  async function handleAnswer(id: number, answer: string) { await answerTask(id, answer); refresh(); }
  async function handleDismiss(id: number) { await dismissTask(id, "dismissed from dashboard"); refresh(); }
  async function handleApproveDose(id: number) {
    try {
      const r = await approveDoseTask(id);
      if (!r.ok) alert(`${t("Not done", "לא בוצע")}: ${r.reason || r.error || t("unknown failure", "כשל לא ידוע")}`);
    } catch (e) {
      alert(`${t("Error", "שגיאה")}: ${e instanceof Error ? e.message : String(e)}`);
    }
    refresh();
  }

  if (loading) return <main style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--c-ash)" }}>{t("Loading…", "טוען נתונים…")}</main>;
  if (error || !state) {
    return (
      <main style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--f-display)", fontSize: "1.5rem", color: "var(--c-parchment)", marginBottom: 8 }}>{t("Connection error", "שגיאת חיבור")}</h2>
          <p style={{ fontSize: ".85rem", color: "var(--c-ash)", wordBreak: "break-word" }}>{error}</p>
        </div>
      </main>
    );
  }

  const r = state.current_reading;
  const d = state.last_decision;
  const status: AgentStatus = (d?.status as AgentStatus) || "unknown";
  const sp = state.system_profile;
  const stagePair = STAGE_LABEL[sp.growth_stage];
  const stage = stagePair ? t(...stagePair) : sp.growth_stage;

  return (
    <main dir={lang === "he" ? "rtl" : "ltr"} style={{ maxWidth: 1180, width: "100%", margin: "0 auto", padding: "1.6rem clamp(0.9rem,3vw,1.6rem) 4rem", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Topbar */}
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "var(--f-display)", fontWeight: 300, fontSize: "clamp(1.9rem,3.5vw,2.6rem)", color: "var(--c-parchment)", lineHeight: 1, letterSpacing: "-.01em" }}>
            {t("Dashboard", "לוח בקרה")}
          </h1>
          <p style={{ fontSize: ".82rem", color: "var(--c-ash)", marginTop: 8 }}>
            {sp.crop_type} · {sp.reservoir_liters}L · {sp.location} · {t("Stage", "שלב")} {stage}
            {state.agent.mock_mode ? <span className="tk-tag" style={{ marginInlineStart: 8 }}>MOCK</span> : null}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: ".62rem", letterSpacing: ".16em", textTransform: "uppercase", color: "var(--c-ash)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_DOT[status], boxShadow: `0 0 0 3px ${STATUS_DOT[status]}22` }} />
          {statusLabel(status, t)}
        </div>
      </header>

      {/* Primary readings */}
      <div className="tk-readings">
        <Reading label="pH" icon="ph-flask" value={r?.ph} digits={2} />
        <Reading label="EC" icon="ph-lightning" value={r?.ec} unit="μS/cm" digits={0} />
        <Reading label={t("Water temp", "טמפ' מים")} icon="ph-drop" value={r?.water_temp} unit="°C" digits={1} />
        <Reading label="ORP" icon="ph-pulse" value={r?.orp} unit="mV" digits={0} />
      </div>

      {/* Expression / readings chart — the one Standard-glow card */}
      <section className="tk-card glow" style={{ padding: 20 }}>
        <div className="tk-card-h"><span className="ct" style={{ color: "var(--c-fog)" }}>{t("Readings · recent", "קריאות · אחרונות")}</span></div>
        <SensorChart />
      </section>

      {/* Secondary readings + bottles */}
      <div className="tk-grid-2">
        <section className="tk-card" style={{ padding: 20 }}>
          <div className="tk-card-h"><span className="ct">{t("More readings", "קריאות נוספות")}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 18px" }}>
            <MiniReading label="TDS" value={r?.tds} unit="ppm" digits={0} />
            <MiniReading label={t("Salinity", "מליחות")} value={r?.salinity} unit="PPM" digits={0} />
            <MiniReading label="S.G." value={r?.sg} digits={3} />
            <MiniReading label="CF" value={r?.cf} digits={2} />
          </div>
        </section>
        <section className="tk-card" style={{ padding: 20 }}>
          <div className="tk-card-h"><span className="ct">{t("Bottle inventory", "מלאי בקבוקים")}</span></div>
          <BottleLevels />
        </section>
      </div>

      {/* The Brain · analysis + status */}
      <div className="tk-grid-2" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        <section className="tk-card" style={{ padding: 22 }}>
          <div className="tk-card-h">
            <span className="ct" style={{ color: "var(--c-fog)", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ph-light ph-brain" style={{ color: "var(--amber)" }} />{t("Brain analysis", "ניתוח המוח")}
            </span>
            <span className="more">{d ? new Date(d.timestamp).toLocaleString(lang === "he" ? "he-IL" : "en-US") : "—"}</span>
          </div>
          <p style={{ fontFamily: "var(--f-display)", fontStyle: "italic", fontWeight: 300, fontSize: "1.15rem", lineHeight: 1.5, color: "var(--c-parchment)" }}>
            {d?.message || t("Waiting for the first analysis…", "ממתין לניתוח ראשון…")}
          </p>
          {d?.analysis ? (
            <details style={{ fontSize: ".8rem", color: "var(--c-ash)", marginTop: 14 }}>
              <summary style={{ cursor: "pointer", color: "var(--c-stone)", letterSpacing: ".04em" }}>{t("Technical detail", "פירוט טכני")}</summary>
              <p style={{ marginTop: 8, lineHeight: 1.6 }} dir="ltr">{d.analysis}</p>
            </details>
          ) : null}
        </section>
        <section className="tk-card" style={{ padding: 22 }}>
          <div className="tk-card-h"><span className="ct">{t("Brain status", "מצב המוח")}</span></div>
          <dl style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Row label={t("Cycle #", "מחזור #")} value={String(state.agent.cycle_count)} />
            <Row label={t("Next analysis", "ניתוח הבא")} value={t(`in ${Math.round(state.agent.next_ai_seconds / 60)} min`, `בעוד ${Math.round(state.agent.next_ai_seconds / 60)} ד'`)} />
            <Row label={t("Model", "מודל")} value={state.agent.model || "claude-sonnet-4-6"} />
            <Row label={t("Growth stage", "שלב גידול")} value={stage} />
          </dl>
        </section>
      </div>

      <TasksPanel tasks={tasks} onApprove={handleApproveDose} onComplete={handleComplete} onDismiss={handleDismiss} onAnswer={handleAnswer} />

      <footer style={{ fontSize: ".7rem", color: "var(--c-stone)", textAlign: "center", paddingTop: 8 }}>
        {t(`Updates every ${REFRESH_MS / 1000}s`, `מתעדכן כל ${REFRESH_MS / 1000} שניות`)}
      </footer>
    </main>
  );
}

function Reading({ label, value, unit, digits, icon }: { label: string; value: number | null | undefined; unit?: string; digits: number; icon?: string }) {
  const display = value === null || value === undefined ? "—" : value.toFixed(digits);
  return (
    <div className="tk-card hover" style={{ padding: 18 }}>
      <div className="tk-reading">
        <div className="l">{icon ? <i className={"ph-light " + icon} /> : null}{label}</div>
        <div className="v" dir="ltr">{display}{unit ? <span className="u">{unit}</span> : null}</div>
      </div>
    </div>
  );
}

function MiniReading({ label, value, unit, digits }: { label: string; value: number | null | undefined; unit?: string; digits: number }) {
  const display = value === null || value === undefined ? "—" : value.toFixed(digits);
  return (
    <div className="tk-reading">
      <div className="l">{label}</div>
      <div className="v" dir="ltr" style={{ fontSize: "1.4rem" }}>{display}{unit ? <span className="u">{unit}</span> : null}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: ".88rem" }}>
      <dt style={{ color: "var(--c-ash)" }}>{label}</dt>
      <dd style={{ color: "var(--c-parchment)" }}>{value}</dd>
    </div>
  );
}

function TasksPanel({
  tasks, onApprove, onComplete, onDismiss, onAnswer,
}: {
  tasks: HumanTask[];
  onApprove: (id: number) => void;
  onComplete: (id: number) => void;
  onDismiss: (id: number) => void;
  onAnswer: (id: number, answer: string) => void;
}) {
  const { t } = useLang();
  const approval = tasks.filter((t) => t.type === "dose_approval");
  const questions = tasks.filter((t) => t.type === "question");
  const hands = tasks.filter((t) => t.type !== "dose_approval" && t.type !== "question");

  if (tasks.length === 0) {
    return (
      <section>
        <div className="tk-card-h"><span className="ct">{t("Pending tasks", "משימות ממתינות")}</span></div>
        <p className="tk-card" style={{ fontSize: ".88rem", color: "var(--c-stone)", textAlign: "center", padding: "2rem" }}>
          {t("No pending tasks. The system is running autonomously.", "אין משימות ממתינות. המערכת רצה אוטונומית.")}
        </p>
      </section>
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {approval.length > 0 ? (
        <div>
          <div className="tk-card-h" style={{ alignItems: "baseline" }}>
            <span className="ct" style={{ color: "var(--c-fog)", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ph-light ph-lightning" style={{ color: "var(--amber)" }} />{t("Awaiting your approval", "ממתין לאישורך")} ({approval.length})
            </span>
            <span className="more">{t("Tap \"Approve & run\" to fire the pump", "לחיצה על \"אשר ובצע\" מפעילה את המשאבה")}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {approval.map((tk) => (
              <TaskCard key={tk.id} t={tk} primaryLabel={t("Approve & run", "אשר ובצע")} onPrimary={() => onApprove(tk.id)} onDismiss={() => onDismiss(tk.id)} />
            ))}
          </ul>
        </div>
      ) : null}

      {questions.length > 0 ? (
        <div>
          <div className="tk-card-h">
            <span className="ct" style={{ color: "var(--c-fog)", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ph-light ph-chat-circle-dots" style={{ color: "var(--amber)" }} />{t("The Brain is asking", "המוח שואל")} ({questions.length})
            </span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {questions.map((q) => (
              <TaskCard key={q.id} t={q} primaryLabel="" onPrimary={() => {}} onDismiss={() => onDismiss(q.id)} onAnswer={(text) => onAnswer(q.id, text)} />
            ))}
          </ul>
        </div>
      ) : null}

      {hands.length > 0 ? (
        <div>
          <div className="tk-card-h">
            <span className="ct" style={{ color: "var(--c-fog)", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="ph-light ph-hand-pointing" style={{ color: "var(--amber)" }} />{t("Needs your hands", "צריך ידיים שלך")} ({hands.length})
            </span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {hands.map((tk) => (
              <TaskCard key={tk.id} t={tk} primaryLabel={t("Done", "בוצע")} onPrimary={() => onComplete(tk.id)} onDismiss={() => onDismiss(tk.id)} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function TaskCard({
  t, primaryLabel, onPrimary, onDismiss, onAnswer,
}: {
  t: HumanTask;
  primaryLabel: string;
  onPrimary: () => void;
  onDismiss: () => void;
  onAnswer?: (text: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const { t: tr } = useLang();
  return (
    <li className="tk-card" style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap", fontSize: ".58rem", letterSpacing: ".1em", textTransform: "uppercase" }}>
            <span style={{ color: "var(--c-basil)" }}>{tr(...PRIORITY_LABEL[t.priority])}</span>
            <span style={{ color: "var(--c-stone)" }}>· {tr(...TASK_TYPE_LABEL[t.type])}</span>
            <span style={{ color: "var(--c-stone)", textTransform: "none", letterSpacing: 0 }}>#{t.id}</span>
          </div>
          <h3 style={{ fontFamily: "var(--f-display)", fontWeight: 500, fontSize: "1.05rem", color: "var(--c-parchment)", lineHeight: 1.3, marginBottom: 5 }}>{t.title}</h3>
          <p style={{ fontSize: ".88rem", color: "var(--c-fog)", lineHeight: 1.5 }}>{t.reason}</p>
          {onAnswer ? (
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && answer.trim()) onAnswer(answer.trim()); }}
              placeholder={tr("Type your answer…", "כתוב את התשובה כאן…")}
              className="text-sm rounded-md px-3 py-2 mt-3 w-full text-[var(--c-parchment)] placeholder:text-[var(--c-stone)] focus:outline-none"
              style={{ background: "var(--c-void)", border: "1px solid rgba(238,237,232,0.12)" }}
            />
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "none" }}>
          {onAnswer ? (
            <button className="tk-btn" disabled={!answer.trim()} style={{ opacity: answer.trim() ? 1 : 0.4 }} onClick={() => answer.trim() && onAnswer(answer.trim())}>{tr("Answer", "ענה")}</button>
          ) : (
            <button className="tk-btn" onClick={onPrimary}>{primaryLabel}</button>
          )}
          <button className="tk-btn-ghost" onClick={onDismiss}>{tr("Dismiss", "בטל")}</button>
        </div>
      </div>
    </li>
  );
}
