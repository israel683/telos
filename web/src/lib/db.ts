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

// Swallow "already exists" Postgres errors that race when multiple cold
// invocations hit CREATE TABLE / CREATE INDEX concurrently. Each function
// invocation has its own process and its own _schemaReady flag, so the first
// few requests can race on the catalog. After the first success, the IF NOT
// EXISTS / catch path is harmless.
async function safeDdl(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("already exists") ||
      msg.includes("duplicate key") ||
      msg.includes("pg_class_relname_nsp_index") ||
      msg.includes("pg_type_typname_nsp_index")
    ) {
      return; // benign race
    }
    throw e;
  }
}

export async function ensureSchema(): Promise<void> {
  if (_schemaReady) return;
  const s = sql();

  await safeDdl(() => s`
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
  `);

  await safeDdl(() => s`
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
  `);

  await safeDdl(() => s`
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
  `);

  await safeDdl(() => s`
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
  `);

  await safeDdl(() => s`CREATE INDEX IF NOT EXISTS idx_readings_ts ON sensor_readings(system_id, ts DESC)`);
  await safeDdl(() => s`CREATE INDEX IF NOT EXISTS idx_decisions_ts ON ai_decisions(system_id, ts DESC)`);
  await safeDdl(() => s`CREATE INDEX IF NOT EXISTS idx_actions_ts ON dosing_actions(system_id, ts DESC)`);
  await safeDdl(() => s`CREATE INDEX IF NOT EXISTS idx_tasks_pending ON human_tasks(system_id, status, priority)`);

  // Chat message history — persists user + assistant turns AND cron-pushed
  // proactive updates so the grower has a single thread per system that
  // survives refreshes.
  await safeDdl(() => s`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id           BIGSERIAL PRIMARY KEY,
      system_id    TEXT NOT NULL DEFAULT 'default',
      thread_id    TEXT NOT NULL DEFAULT 'main',
      ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      role         TEXT NOT NULL,
      parts        JSONB NOT NULL,
      source       TEXT NOT NULL DEFAULT 'chat',
      decision_id  BIGINT REFERENCES ai_decisions(id),
      client_id    TEXT,
      status       TEXT
    )
  `);
  await safeDdl(() => s`CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_messages(system_id, thread_id, ts)`);

  // First-class systems table — each row is an isolated project.
  // `dosing_config` JSONB carries the per-system fertilizer profile + channel
  // mapping (see lib/dosing-config.ts).  NULL means "use the legacy default
  // (Terra Aquatica Tri Part + pH Up on 1/2/3/4)" — kept that way so the
  // original POC row keeps working without a data migration.
  await safeDdl(() => s`
    CREATE TABLE IF NOT EXISTS systems (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'active',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      archived_at       TIMESTAMPTZ,
      crop_type         TEXT NOT NULL DEFAULT 'lettuce',
      growth_stage      TEXT NOT NULL DEFAULT 'vegetative',
      reservoir_liters  INTEGER NOT NULL DEFAULT 60,
      system_type       TEXT NOT NULL DEFAULT 'nft_wall_mounted',
      location          TEXT NOT NULL DEFAULT 'Tel Aviv, Israel',
      outdoor           BOOLEAN NOT NULL DEFAULT TRUE,
      ai_cycle_minutes  INTEGER NOT NULL DEFAULT 60,
      tuya_device_id    TEXT,
      notes             TEXT,
      dosing_config     JSONB,
      next_check_at     TIMESTAMPTZ,
      setup_completed_at TIMESTAMPTZ
    )
  `);

  // Additive migrations for rows that pre-date the newer columns.
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS dosing_config JSONB
  `);
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ
  `);
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ
  `);

  // NOTE: we used to auto-create a 'default' row on every bootstrap so the
  // single-system POC always had a parent for incoming readings.  That made
  // the systems table impossible to truly empty — every API hit would
  // recreate the placeholder.  Now the grower creates systems explicitly
  // through the UI (POST /api/systems) or via the agronomist's onboarding
  // flow.  The SystemSwitcher renders an empty-state ("אין מערכות עדיין")
  // when no rows exist, and the cron routes filter to status=active so a
  // zero-row DB is a no-op rather than a crash.

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

// Backward-compat default systemId. New code should pass systemId explicitly.
export const DEFAULT_SYSTEM_ID = "default";

// === Systems CRUD ===

export type SystemRow = {
  id: string;
  name: string;
  status: "active" | "paused" | "archived";
  created_at: Date;
  archived_at: Date | null;
  crop_type: string;
  growth_stage: string;
  reservoir_liters: number;
  system_type: string;
  location: string;
  outdoor: boolean;
  ai_cycle_minutes: number;
  tuya_device_id: string | null;
  notes: string | null;
  /**
   * JSONB blob persisted in `systems.dosing_config`. Shape parsed by
   * lib/dosing-config.ts — kept loose here so this layer stays schema-only.
   * NULL means "fall back to the legacy default" (Terra Aquatica Tri Part).
   */
  dosing_config: Record<string, unknown> | null;
  /**
   * The earliest time the autonomous LLM cycle is allowed to invoke Claude
   * for this system again.  Lives on the system row (not on decisions) so
   * the cycle gate can SELECT it in one query.  NULL = "run on next cron
   * tick".  Updated by the cycle handler after each LLM call based on the
   * `next_check_minutes` Claude returned.
   */
  next_check_at: Date | null;
  /**
   * Wall-clock moment the physical install was confirmed running by the
   * grower.  Sensor readings BEFORE this timestamp are noise (sensor was
   * in the package, on a shelf, drying after calibration, etc.) and are
   * filtered out of every reading-query by default.
   *
   * NULL means setup hasn't been confirmed yet — readings exist in the DB
   * for diagnostic purposes (proves Tuya connectivity) but the autonomous
   * brain refuses to reason on them.
   */
  setup_completed_at: Date | null;
};

function rowToSystem(row: Record<string, unknown>): SystemRow {
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as SystemRow["status"],
    created_at: new Date(row.created_at as string),
    archived_at: row.archived_at ? new Date(row.archived_at as string) : null,
    crop_type: row.crop_type as string,
    growth_stage: row.growth_stage as string,
    reservoir_liters: Number(row.reservoir_liters),
    system_type: row.system_type as string,
    location: row.location as string,
    outdoor: Boolean(row.outdoor),
    ai_cycle_minutes: Number(row.ai_cycle_minutes),
    tuya_device_id: (row.tuya_device_id as string) ?? null,
    notes: (row.notes as string) ?? null,
    dosing_config: (row.dosing_config as Record<string, unknown> | null) ?? null,
    next_check_at: row.next_check_at ? new Date(row.next_check_at as string) : null,
    setup_completed_at: row.setup_completed_at
      ? new Date(row.setup_completed_at as string)
      : null,
  };
}

/**
 * Persist the next-earliest time this system is allowed to invoke a full
 * LLM cycle.  Called from the cron handler after each cycle (run-or-skipped)
 * so the gate has a deterministic minimum spacing.
 */
export async function setNextCheckAt(systemId: string, when: Date): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`UPDATE systems SET next_check_at = ${when.toISOString()} WHERE id = ${systemId}`;
}

/**
 * Mark the moment the physical system was confirmed running.  Called by the
 * agent's `markSetupComplete` tool once the grower says the sensor is in
 * the reservoir and the system is live.  All reading-queries (cron,
 * dashboard, chat) start filtering on `ts >= setup_completed_at` from this
 * point on, so the brain never reasons on pre-install sensor noise.
 *
 * Passing `null` clears the marker — useful if the grower hits "I made a
 * mistake, the install isn't done" via a future maintenance action.
 */
export async function markSetupComplete(
  systemId: string,
  when: Date | null = new Date()
): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`UPDATE systems SET setup_completed_at = ${when ? when.toISOString() : null} WHERE id = ${systemId}`;
}

export async function listSystems(includeArchived = false): Promise<SystemRow[]> {
  await ensureSchema();
  const s = sql();
  const rows = (includeArchived
    ? await s`SELECT * FROM systems ORDER BY created_at DESC`
    : await s`SELECT * FROM systems WHERE status <> 'archived' ORDER BY created_at DESC`) as unknown as Array<Record<string, unknown>>;
  return rows.map(rowToSystem);
}

export async function getSystem(id: string): Promise<SystemRow | null> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`SELECT * FROM systems WHERE id = ${id}`) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? rowToSystem(rows[0]) : null;
}

export async function createSystem(input: {
  id: string;
  name: string;
  crop_type?: string;
  growth_stage?: string;
  reservoir_liters?: number;
  system_type?: string;
  location?: string;
  outdoor?: boolean;
  ai_cycle_minutes?: number;
  tuya_device_id?: string | null;
  notes?: string | null;
  dosing_config?: Record<string, unknown> | null;
}): Promise<SystemRow> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    INSERT INTO systems (id, name, crop_type, growth_stage, reservoir_liters,
                         system_type, location, outdoor, ai_cycle_minutes,
                         tuya_device_id, notes, dosing_config)
    VALUES (
      ${input.id}, ${input.name},
      ${input.crop_type ?? "lettuce"},
      ${input.growth_stage ?? "vegetative"},
      ${input.reservoir_liters ?? 60},
      ${input.system_type ?? "nft_wall_mounted"},
      ${input.location ?? "Tel Aviv, Israel"},
      ${input.outdoor ?? true},
      ${input.ai_cycle_minutes ?? 60},
      ${input.tuya_device_id ?? null},
      ${input.notes ?? null},
      ${input.dosing_config ? JSON.stringify(input.dosing_config) : null}::jsonb
    )
    RETURNING *
  `) as unknown as Array<Record<string, unknown>>;
  return rowToSystem(rows[0]);
}

export async function updateSystem(
  id: string,
  patch: Partial<Omit<SystemRow, "id" | "created_at" | "archived_at">>
): Promise<SystemRow | null> {
  await ensureSchema();
  const s = sql();
  // Build dynamic update by running individual updates (Neon's tagged-template
  // limit makes building a dynamic SET clause awkward; do per-field updates).
  const fields: Array<[keyof typeof patch, unknown]> = [];
  if (patch.name !== undefined) fields.push(["name", patch.name]);
  if (patch.status !== undefined) fields.push(["status", patch.status]);
  if (patch.crop_type !== undefined) fields.push(["crop_type", patch.crop_type]);
  if (patch.growth_stage !== undefined) fields.push(["growth_stage", patch.growth_stage]);
  if (patch.reservoir_liters !== undefined) fields.push(["reservoir_liters", patch.reservoir_liters]);
  if (patch.system_type !== undefined) fields.push(["system_type", patch.system_type]);
  if (patch.location !== undefined) fields.push(["location", patch.location]);
  if (patch.outdoor !== undefined) fields.push(["outdoor", patch.outdoor]);
  if (patch.ai_cycle_minutes !== undefined) fields.push(["ai_cycle_minutes", patch.ai_cycle_minutes]);
  if (patch.tuya_device_id !== undefined) fields.push(["tuya_device_id", patch.tuya_device_id]);
  if (patch.notes !== undefined) fields.push(["notes", patch.notes]);
  // dosing_config is JSONB → serialize and cast via SQL.  Handled outside the
  // generic loop below because it needs the ::jsonb cast on the bind.
  for (const [k, v] of fields) {
    // The column name is constrained to the known list above so injection-safe.
    await s.query(`UPDATE systems SET ${k as string} = $1 WHERE id = $2`, [v, id]);
  }
  if (patch.dosing_config !== undefined) {
    const blob = patch.dosing_config === null ? null : JSON.stringify(patch.dosing_config);
    await s.query(
      `UPDATE systems SET dosing_config = $1::jsonb WHERE id = $2`,
      [blob, id]
    );
  }
  return getSystem(id);
}

export async function archiveSystem(id: string): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`UPDATE systems SET status = 'archived', archived_at = NOW() WHERE id = ${id}`;
}

// === Readings ===

export async function saveReading(
  r: Omit<WaterReading, "ts" | "id"> & { ts?: Date },
  systemId: string = DEFAULT_SYSTEM_ID
) {
  await ensureSchema();
  const s = sql();
  const ts = r.ts ?? new Date();
  await s`
    INSERT INTO sensor_readings
      (system_id, ts, ph, ec, tds, orp, water_temp, cf, salinity, sg, source)
    VALUES
      (${systemId}, ${ts.toISOString()}, ${r.ph}, ${r.ec}, ${r.tds}, ${r.orp},
       ${r.water_temp}, ${r.cf}, ${r.salinity}, ${r.sg}, ${r.source})
  `;
}

export async function getRecentReadings(
  hours = 24,
  limit = 500,
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<WaterReading[]> {
  await ensureSchema();
  const s = sql();
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  // Honour the per-system setup_completed_at marker — readings from before
  // the grower confirmed the physical install was running are noise
  // (sensor was in the package / on a shelf / drying after calibration).
  // We fetch the marker in the same query via a sub-select so callers don't
  // have to thread it through manually.
  const rows = (await s`
    SELECT id, ts, ph, ec, tds, orp, water_temp, cf, salinity, sg, source
    FROM sensor_readings
    WHERE system_id = ${systemId}
      AND ts > ${cutoff}
      AND ts >= COALESCE(
        (SELECT setup_completed_at FROM systems WHERE id = ${systemId}),
        ts
      )
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
  d: Omit<Decision, "id" | "ts"> & { ts?: Date },
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<number> {
  await ensureSchema();
  const s = sql();
  const ts = d.ts ?? new Date();
  const rows = (await s`
    INSERT INTO ai_decisions
      (system_id, ts, status, analysis, message, raw_response,
       tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens)
    VALUES
      (${systemId}, ${ts.toISOString()}, ${d.status}, ${d.analysis}, ${d.message},
       ${JSON.stringify(d.raw_response)}::jsonb,
       ${d.tokens_input}, ${d.tokens_output}, ${d.cache_creation_tokens}, ${d.cache_read_tokens})
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows[0].id;
}

export async function getRecentDecisions(
  limit = 20,
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<Decision[]> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, ts, status, analysis, message, raw_response,
           tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens
    FROM ai_decisions
    WHERE system_id = ${systemId}
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

export async function saveAction(
  a: Omit<DosingAction, "ts" | "id"> & { ts?: Date },
  systemId: string = DEFAULT_SYSTEM_ID
) {
  await ensureSchema();
  const s = sql();
  const ts = a.ts ?? new Date();
  await s`
    INSERT INTO dosing_actions
      (system_id, ts, channel, amount_ml, reason, success, ai_status, ai_analysis, decision_id)
    VALUES
      (${systemId}, ${ts.toISOString()}, ${a.channel}, ${a.amount_ml}, ${a.reason},
       ${a.success}, ${a.ai_status ?? null}, ${a.ai_analysis ?? null}, ${a.decision_id ?? null})
  `;
}

export async function getRecentActions(
  hours = 24,
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<DosingAction[]> {
  await ensureSchema();
  const s = sql();
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const rows = (await s`
    SELECT id, ts, channel, amount_ml, reason, success, ai_status, ai_analysis, decision_id
    FROM dosing_actions
    WHERE system_id = ${systemId} AND ts > ${cutoff}
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

export async function createHumanTask(
  t: {
    type: TaskType;
    priority: TaskPriority;
    title: string;
    reason: string;
    payload?: Record<string, unknown>;
    expires_in_hours?: number | null;
    decision_id?: number | null;
  },
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<number> {
  await ensureSchema();
  const s = sql();
  const expiresAt = t.expires_in_hours
    ? new Date(Date.now() + t.expires_in_hours * 3600 * 1000).toISOString()
    : null;
  const rows = (await s`
    INSERT INTO human_tasks
      (system_id, type, priority, title, reason, payload, expires_at, decision_id, status)
    VALUES
      (${systemId}, ${t.type}, ${t.priority}, ${t.title}, ${t.reason},
       ${JSON.stringify(t.payload ?? {})}::jsonb,
       ${expiresAt}, ${t.decision_id ?? null}, 'pending')
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows[0].id;
}

export async function getPendingTasks(
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<HumanTask[]> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, system_id, created_at, type, priority, title, reason, payload,
           status, expires_at, completed_at, user_response, decision_id
    FROM human_tasks
    WHERE system_id = ${systemId} AND status = 'pending'
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
  status: "pending" | "done" | "dismissed" | "expired",
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<HumanTask[]> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, system_id, created_at, type, priority, title, reason, payload,
           status, expires_at, completed_at, user_response, decision_id
    FROM human_tasks
    WHERE system_id = ${systemId} AND status = ${status}
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

export async function completeTask(
  id: number,
  response = "",
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`
    UPDATE human_tasks
    SET status = 'done', completed_at = NOW(), user_response = ${response}
    WHERE id = ${id} AND system_id = ${systemId}
  `;
}

export async function dismissTask(
  id: number,
  response = "",
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`
    UPDATE human_tasks
    SET status = 'dismissed', completed_at = NOW(), user_response = ${response}
    WHERE id = ${id} AND system_id = ${systemId}
  `;
}

export async function expireOldTasks(
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<number> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    UPDATE human_tasks
    SET status = 'expired'
    WHERE system_id = ${systemId}
      AND status = 'pending'
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows.length;
}

// === Chat history ===

export type ChatMessageRole = "user" | "assistant" | "system";
export type ChatMessageSource = "chat" | "cron-cycle" | "cron-poll" | "system";

export type ChatMessageRow = {
  id: number;
  system_id: string;
  thread_id: string;
  ts: Date;
  role: ChatMessageRole;
  parts: Array<Record<string, unknown>>;
  source: ChatMessageSource;
  decision_id: number | null;
  client_id: string | null;
  status: string | null;
};

export async function saveChatMessage(opts: {
  systemId?: string;
  threadId?: string;
  role: ChatMessageRole;
  parts: Array<Record<string, unknown>>;
  source?: ChatMessageSource;
  decisionId?: number | null;
  clientId?: string | null;
  status?: string | null;
}): Promise<number> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    INSERT INTO chat_messages
      (system_id, thread_id, role, parts, source, decision_id, client_id, status)
    VALUES (
      ${opts.systemId ?? DEFAULT_SYSTEM_ID},
      ${opts.threadId ?? "main"},
      ${opts.role},
      ${JSON.stringify(opts.parts)}::jsonb,
      ${opts.source ?? "chat"},
      ${opts.decisionId ?? null},
      ${opts.clientId ?? null},
      ${opts.status ?? null}
    )
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows[0].id;
}

export async function getChatHistory(
  systemId: string = DEFAULT_SYSTEM_ID,
  threadId: string = "main",
  limit: number = 200
): Promise<ChatMessageRow[]> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, system_id, thread_id, ts, role, parts, source, decision_id,
           client_id, status
    FROM chat_messages
    WHERE system_id = ${systemId} AND thread_id = ${threadId}
    ORDER BY ts DESC
    LIMIT ${limit}
  `) as unknown as Array<{
    id: number;
    system_id: string;
    thread_id: string;
    ts: string;
    role: ChatMessageRole;
    parts: Array<Record<string, unknown>>;
    source: ChatMessageSource;
    decision_id: number | null;
    client_id: string | null;
    status: string | null;
  }>;
  return rows
    .map((r) => ({ ...r, ts: new Date(r.ts) }))
    .reverse(); // chronological order for chat rendering
}

export async function hasPendingTaskOfType(
  t: TaskType,
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT 1 FROM human_tasks
    WHERE system_id = ${systemId} AND status = 'pending' AND type = ${t}
    LIMIT 1
  `) as unknown as Array<unknown>;
  return rows.length > 0;
}
