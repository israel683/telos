/**
 * GrowK data layer — Neon Postgres via serverless driver.
 *
 * Schema mirrors the Python SQLite version (see growk/data/store.py for history):
 *   sensor_readings · dosing_actions · ai_decisions · human_tasks
 *
 * `system_id` carried from day one so we can scale to multiple hydroponic
 * systems without a migration.
 *
 * Idempotent schema bootstrap runs on first call to `ensureSchema()`; safe to
 * invoke from any cron/API handler.
 */
import { neon, NeonQueryFunction } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

let _sql: NeonQueryFunction<false, false> | null = null;
let _schemaReady = false;

export function sql(): NeonQueryFunction<false, false> {
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL not set. Provision a Neon Postgres database via Vercel " +
        "marketplace integration; it will inject this env var automatically."
    );
  }
  if (!_sql) _sql = neon(DATABASE_URL);
  return _sql;
}

export async function ensureSchema(): Promise<void> {
  if (_schemaReady) return;
  const s = sql();

  await s`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id          BIGSERIAL PRIMARY KEY,
      system_id   TEXT NOT NULL DEFAULT 'default',
      ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ph          DOUBLE PRECISION,
      ec          DOUBLE PRECISION,
      tds         DOUBLE PRECISION,
      orp         DOUBLE PRECISION,
      water_temp  DOUBLE PRECISION,
      cf          DOUBLE PRECISION,
      salinity    DOUBLE PRECISION,
      sg          DOUBLE PRECISION,
      source      TEXT
    )
  `;

  await s`
    CREATE TABLE IF NOT EXISTS ai_decisions (
      id                     BIGSERIAL PRIMARY KEY,
      system_id              TEXT NOT NULL DEFAULT 'default',
      ts                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status                 TEXT,
      analysis               TEXT,
      message                TEXT,
      raw_response           JSONB,
      tokens_input           INTEGER,
      tokens_output          INTEGER,
      cache_creation_tokens  INTEGER,
      cache_read_tokens      INTEGER
    )
  `;

  await s`
    CREATE TABLE IF NOT EXISTS dosing_actions (
      id            BIGSERIAL PRIMARY KEY,
      system_id     TEXT NOT NULL DEFAULT 'default',
      ts            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      channel       TEXT NOT NULL,
      amount_ml     DOUBLE PRECISION NOT NULL,
      reason        TEXT,
      success       BOOLEAN NOT NULL DEFAULT FALSE,
      ai_status     TEXT,
      ai_analysis   TEXT,
      decision_id   BIGINT REFERENCES ai_decisions(id)
    )
  `;

  await s`
    CREATE TABLE IF NOT EXISTS human_tasks (
      id            BIGSERIAL PRIMARY KEY,
      system_id     TEXT NOT NULL DEFAULT 'default',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      type          TEXT NOT NULL,
      priority      TEXT NOT NULL,
      title         TEXT NOT NULL,
      reason        TEXT NOT NULL,
      payload       JSONB,
      status        TEXT NOT NULL DEFAULT 'pending',
      expires_at    TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ,
      user_response TEXT,
      decision_id   BIGINT REFERENCES ai_decisions(id)
    )
  `;

  await s`CREATE INDEX IF NOT EXISTS idx_readings_ts ON sensor_readings(system_id, ts DESC)`;
  await s`CREATE INDEX IF NOT EXISTS idx_decisions_ts ON ai_decisions(system_id, ts DESC)`;
  await s`CREATE INDEX IF NOT EXISTS idx_actions_ts ON dosing_actions(system_id, ts DESC)`;
  await s`CREATE INDEX IF NOT EXISTS idx_tasks_pending ON human_tasks(system_id, status, priority)`;

  _schemaReady = true;
}

// === Types ===

export type WaterReading = {
  id?: number;
  ts: Date;
  ph: number | null;
  ec: number | null;
  tds: number | null;
  orp: number | null;
  water_temp: number | null;
  cf: number | null;
  salinity: number | null;
  sg: number | null;
  source: string;
};

export type Decision = {
  id: number;
  ts: Date;
  status: string;
  analysis: string;
  message: string;
  raw_response: Record<string, unknown>;
  tokens_input: number;
  tokens_output: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
};

export type DosingAction = {
  id?: number;
  ts: Date;
  channel: string;
  amount_ml: number;
  reason: string;
  success: boolean;
  ai_status?: string;
  ai_analysis?: string;
  decision_id?: number;
};

export type TaskType =
  | "water_change"
  | "dose_approval"
  | "system_reset"
  | "question"
  | "manual_action";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type HumanTask = {
  id: number;
  system_id: string;
  created_at: Date;
  type: TaskType;
  priority: TaskPriority;
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  status: "pending" | "done" | "dismissed" | "expired";
  expires_at: Date | null;
  completed_at: Date | null;
  user_response: string | null;
  decision_id: number | null;
};

export const SYSTEM_ID = process.env.SYSTEM_ID || "default";

// === Readings ===

export async function saveReading(r: Omit<WaterReading, "ts" | "id"> & { ts?: Date }) {
  await ensureSchema();
  const s = sql();
  const ts = r.ts ?? new Date();
  await s`
    INSERT INTO sensor_readings
      (system_id, ts, ph, ec, tds, orp, water_temp, cf, salinity, sg, source)
    VALUES
      (${SYSTEM_ID}, ${ts.toISOString()}, ${r.ph}, ${r.ec}, ${r.tds}, ${r.orp},
       ${r.water_temp}, ${r.cf}, ${r.salinity}, ${r.sg}, ${r.source})
  `;
}

export async function getRecentReadings(hours = 24, limit = 500): Promise<WaterReading[]> {
  await ensureSchema();
  const s = sql();
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const rows = (await s`
    SELECT id, ts, ph, ec, tds, orp, water_temp, cf, salinity, sg, source
    FROM sensor_readings
    WHERE system_id = ${SYSTEM_ID} AND ts > ${cutoff}
    ORDER BY ts DESC LIMIT ${limit}
  `) as unknown as Array<{
    id: number;
    ts: string;
    ph: number | null;
    ec: number | null;
    tds: number | null;
    orp: number | null;
    water_temp: number | null;
    cf: number | null;
    salinity: number | null;
    sg: number | null;
    source: string;
  }>;
  return rows
    .map((row) => ({
      id: row.id,
      ts: new Date(row.ts),
      ph: row.ph,
      ec: row.ec,
      tds: row.tds,
      orp: row.orp,
      water_temp: row.water_temp,
      cf: row.cf,
      salinity: row.salinity,
      sg: row.sg,
      source: row.source,
    }))
    .reverse(); // chronological
}

// === Decisions ===

export async function saveDecision(
  d: Omit<Decision, "id" | "ts"> & { ts?: Date }
): Promise<number> {
  await ensureSchema();
  const s = sql();
  const ts = d.ts ?? new Date();
  const rows = (await s`
    INSERT INTO ai_decisions
      (system_id, ts, status, analysis, message, raw_response,
       tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens)
    VALUES
      (${SYSTEM_ID}, ${ts.toISOString()}, ${d.status}, ${d.analysis}, ${d.message},
       ${JSON.stringify(d.raw_response)}::jsonb,
       ${d.tokens_input}, ${d.tokens_output}, ${d.cache_creation_tokens}, ${d.cache_read_tokens})
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows[0].id;
}

export async function getRecentDecisions(limit = 20): Promise<Decision[]> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, ts, status, analysis, message, raw_response,
           tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens
    FROM ai_decisions
    WHERE system_id = ${SYSTEM_ID}
    ORDER BY ts DESC LIMIT ${limit}
  `) as unknown as Array<{
    id: number;
    ts: string;
    status: string;
    analysis: string;
    message: string;
    raw_response: Record<string, unknown>;
    tokens_input: number;
    tokens_output: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
  }>;
  return rows.map((r) => ({ ...r, ts: new Date(r.ts) }));
}

// === Dosing actions ===

export async function saveAction(a: Omit<DosingAction, "ts" | "id"> & { ts?: Date }) {
  await ensureSchema();
  const s = sql();
  const ts = a.ts ?? new Date();
  await s`
    INSERT INTO dosing_actions
      (system_id, ts, channel, amount_ml, reason, success, ai_status, ai_analysis, decision_id)
    VALUES
      (${SYSTEM_ID}, ${ts.toISOString()}, ${a.channel}, ${a.amount_ml}, ${a.reason},
       ${a.success}, ${a.ai_status ?? null}, ${a.ai_analysis ?? null}, ${a.decision_id ?? null})
  `;
}

export async function getRecentActions(hours = 24): Promise<DosingAction[]> {
  await ensureSchema();
  const s = sql();
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const rows = (await s`
    SELECT id, ts, channel, amount_ml, reason, success, ai_status, ai_analysis, decision_id
    FROM dosing_actions
    WHERE system_id = ${SYSTEM_ID} AND ts > ${cutoff}
    ORDER BY ts ASC
  `) as unknown as Array<{
    id: number;
    ts: string;
    channel: string;
    amount_ml: number;
    reason: string;
    success: boolean;
    ai_status: string | null;
    ai_analysis: string | null;
    decision_id: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    ts: new Date(r.ts),
    channel: r.channel,
    amount_ml: r.amount_ml,
    reason: r.reason,
    success: r.success,
    ai_status: r.ai_status ?? undefined,
    ai_analysis: r.ai_analysis ?? undefined,
    decision_id: r.decision_id ?? undefined,
  }));
}

// === Human task queue ===

export const TASK_TYPES: TaskType[] = [
  "water_change",
  "dose_approval",
  "system_reset",
  "question",
  "manual_action",
];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export async function createHumanTask(t: {
  type: TaskType;
  priority: TaskPriority;
  title: string;
  reason: string;
  payload?: Record<string, unknown>;
  expires_in_hours?: number | null;
  decision_id?: number | null;
}): Promise<number> {
  await ensureSchema();
  const s = sql();
  const expiresAt = t.expires_in_hours
    ? new Date(Date.now() + t.expires_in_hours * 3600 * 1000).toISOString()
    : null;
  const rows = (await s`
    INSERT INTO human_tasks
      (system_id, type, priority, title, reason, payload, expires_at, decision_id, status)
    VALUES
      (${SYSTEM_ID}, ${t.type}, ${t.priority}, ${t.title}, ${t.reason},
       ${JSON.stringify(t.payload ?? {})}::jsonb,
       ${expiresAt}, ${t.decision_id ?? null}, 'pending')
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows[0].id;
}

export async function getPendingTasks(): Promise<HumanTask[]> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, system_id, created_at, type, priority, title, reason, payload,
           status, expires_at, completed_at, user_response, decision_id
    FROM human_tasks
    WHERE system_id = ${SYSTEM_ID} AND status = 'pending'
    ORDER BY
      CASE priority
        WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
        WHEN 'medium' THEN 2 WHEN 'low' THEN 3
      END, created_at
  `) as unknown as Array<{
    id: number;
    system_id: string;
    created_at: string;
    type: TaskType;
    priority: TaskPriority;
    title: string;
    reason: string;
    payload: Record<string, unknown>;
    status: "pending" | "done" | "dismissed" | "expired";
    expires_at: string | null;
    completed_at: string | null;
    user_response: string | null;
    decision_id: number | null;
  }>;
  return rows.map((r) => ({
    ...r,
    created_at: new Date(r.created_at),
    expires_at: r.expires_at ? new Date(r.expires_at) : null,
    completed_at: r.completed_at ? new Date(r.completed_at) : null,
  }));
}

export async function getTasksByStatus(
  status: "pending" | "done" | "dismissed" | "expired"
): Promise<HumanTask[]> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, system_id, created_at, type, priority, title, reason, payload,
           status, expires_at, completed_at, user_response, decision_id
    FROM human_tasks
    WHERE system_id = ${SYSTEM_ID} AND status = ${status}
    ORDER BY created_at DESC LIMIT 100
  `) as unknown as Array<{
    id: number;
    system_id: string;
    created_at: string;
    type: TaskType;
    priority: TaskPriority;
    title: string;
    reason: string;
    payload: Record<string, unknown>;
    status: "pending" | "done" | "dismissed" | "expired";
    expires_at: string | null;
    completed_at: string | null;
    user_response: string | null;
    decision_id: number | null;
  }>;
  return rows.map((r) => ({
    ...r,
    created_at: new Date(r.created_at),
    expires_at: r.expires_at ? new Date(r.expires_at) : null,
    completed_at: r.completed_at ? new Date(r.completed_at) : null,
  }));
}

export async function completeTask(id: number, response = ""): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`
    UPDATE human_tasks
    SET status = 'done', completed_at = NOW(), user_response = ${response}
    WHERE id = ${id} AND system_id = ${SYSTEM_ID}
  `;
}

export async function dismissTask(id: number, response = ""): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`
    UPDATE human_tasks
    SET status = 'dismissed', completed_at = NOW(), user_response = ${response}
    WHERE id = ${id} AND system_id = ${SYSTEM_ID}
  `;
}

export async function expireOldTasks(): Promise<number> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    UPDATE human_tasks
    SET status = 'expired'
    WHERE system_id = ${SYSTEM_ID}
      AND status = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows.length;
}

export async function hasPendingTaskOfType(t: TaskType): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT 1 FROM human_tasks
    WHERE system_id = ${SYSTEM_ID} AND status = 'pending' AND type = ${t}
    LIMIT 1
  `) as unknown as Array<unknown>;
  return rows.length > 0;
}
