/**
 * Telos data layer — Neon Postgres via serverless driver.
 *
 * Schema mirrors the Python SQLite version that pre-dated the v0.3 rename
 * (see ../../growk/data/store.py in the git history, when the project was
 * still called GrowK).
 *   sensor_readings · dosing_actions · ai_decisions · human_tasks
 *
 * `system_id` carried from day one so we can scale to multiple hydroponic
 * systems without a migration.
 *
 * Idempotent schema bootstrap runs on first call to `ensureSchema()`; safe to
 * invoke from any cron/API handler.
 */
import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import type { GrowProfile } from "./grow-profile";
import type { GrowerMemoryEntry, GrowerMemoryKind, GrowEpisode } from "./grower-memory";

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
      setup_completed_at TIMESTAMPTZ,
      autonomous_dosing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      doser_verified    BOOLEAN NOT NULL DEFAULT FALSE,
      bottle_levels     JSONB,
      bottle_capacities JSONB,
      bottle_verified_at JSONB,
      target_ranges     JSONB
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
  // Critical guardrail: a fresh system MUST NOT execute autonomous doses
  // until the grower has verified the doser hardware via the doser protocol
  // and explicitly flipped this flag on.  Default FALSE protects new
  // installs from the failure mode where the brain ran overnight on an
  // unverified rig, fired phantom "priming" doses, and emptied bottles
  // before the grower woke up.
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS autonomous_dosing_enabled BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS doser_verified BOOLEAN NOT NULL DEFAULT FALSE
  `);
  // Per-channel remaining liquid (ml).  Shape: { "<channel-key>": ml }.
  // Decremented on every successful dose.  When a channel's level drops
  // below MIN_BOTTLE_ML_TO_DOSE the safety controller blocks new doses on
  // that channel until the grower marks it refilled.
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS bottle_levels JSONB
  `);
  // Per-channel bottle CAPACITY (ml when full / last-refilled).
  // Together with bottle_levels (current remaining) we can compute %
  // remaining, consumption rate, and predicted days-until-empty — and
  // run sanity checks comparing tracked-remaining vs grower-reported.
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS bottle_capacities JSONB
  `);
  // Per-channel timestamp of last grower-confirmed visual verification.
  // Used by the agent to decide when to nudge "let's verify levels again".
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS bottle_verified_at JSONB
  `);
  // Per-system overrides for the tolerance bands (otherwise crop+stage
  // defaults from lib/tolerance.ts apply).  Shape: { ph?:{target,tolerance,tolerance_mode}, ec?:{...}, water_temp?:{...} }
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS target_ranges JSONB
  `);
  // Sensor data source.  'tuya_cloud' (default) → cron-poll pulls from Tuya.
  // 'home_assistant' → cron-poll skips this system; readings arrive via
  // POST /api/sensor/ingest pushed from a Home Assistant automation.
  // Future values: 'mqtt', 'webhook_generic', etc.
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS device_source TEXT NOT NULL DEFAULT 'tuya_cloud'
  `);
  // Optional cultivar id from the shared registry (growk/cultivars/ →
  // lib/cultivars.generated.ts), e.g. 'basilico-genovese-dop'. When set, target
  // resolution reasons at cultivar level; NULL → resolve by crop_type, then the
  // crop+stage defaults in lib/tolerance.ts.  The brand sells cultivar, not crop.
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS cultivar_id TEXT
  `);
  // The personal Brain of this grow (Grow Context layer) — typed answers to the
  // onboarding questions: water source + baseline, light, climate, business
  // goal, grower practices.  Shape parsed by lib/grow-profile.ts.  NULL = grow
  // not yet onboarded.  Per-grow dynamic state, so it lives here (Neon).
  await safeDdl(() => s`
    ALTER TABLE systems ADD COLUMN IF NOT EXISTS grow_profile JSONB
  `);
  // Per-task snooze: a task with snoozed_until > NOW() is hidden from the
  // pending list (and the chat widget) until that timestamp passes.  Used
  // when the grower wants to act on a task "later today" without dismissing.
  await safeDdl(() => s`
    ALTER TABLE human_tasks ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ
  `);

  // Grower Memory — the persistent knowledge the grower teaches the Brain about
  // a grow: facts, corrections, preferences.  The third knowledge layer; it
  // accumulates and is injected into every cycle prompt (lib/grower-memory.ts).
  // `active=false` soft-deletes an entry the grower retracted.
  await safeDdl(() => s`
    CREATE TABLE IF NOT EXISTS grower_memory (
      id          BIGSERIAL PRIMARY KEY,
      system_id   TEXT NOT NULL DEFAULT 'default',
      ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      kind        TEXT NOT NULL DEFAULT 'fact',
      text        TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT 'grower',
      active      BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await safeDdl(() => s`CREATE INDEX IF NOT EXISTS idx_memory_active ON grower_memory(system_id, active, ts DESC)`);

  // Episodic memory — a compact narrative log of what the autonomous Brain did
  // each cycle (status + one-line summary), so future cycles have continuity
  // beyond the 24h action window.  Distinct from grower_memory (what the GROWER
  // taught); this is what the BRAIN did.  See lib/grower-memory.ts render.
  await safeDdl(() => s`
    CREATE TABLE IF NOT EXISTS grow_episodes (
      id          BIGSERIAL PRIMARY KEY,
      system_id   TEXT NOT NULL DEFAULT 'default',
      ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status      TEXT,
      summary     TEXT NOT NULL,
      decision_id BIGINT REFERENCES ai_decisions(id)
    )
  `);
  await safeDdl(() => s`CREATE INDEX IF NOT EXISTS idx_episodes_ts ON grow_episodes(system_id, ts DESC)`);

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
  /**
   * Optional cultivar id from the shared registry (lib/cultivars.ts), e.g.
   * 'basilico-genovese-dop'.  NULL → resolve targets by crop_type.  The brand
   * sells cultivar, not crop — this is where the dashboard reasons at that level.
   */
  cultivar_id: string | null;
  /**
   * The personal Brain of this grow (Grow Context) — typed onboarding answers.
   * NULL = not yet onboarded.  Shape in lib/grow-profile.ts.
   */
  grow_profile: GrowProfile | null;
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
  /**
   * Master safety flag for the autonomous loop.  When FALSE (default for
   * new installs), the cron-driven brain may still REASON and create
   * dose_approval Human Tasks, but it WILL NOT execute pumps directly.
   * Flipped to TRUE only via explicit grower action AFTER the doser
   * protocol has been run successfully.
   */
  autonomous_dosing_enabled: boolean;
  /**
   * Set to TRUE once the grower has run the doser protocol — primed every
   * channel + did a tiny verification dose to confirm pumps actually move
   * liquid + confirmed correct channel mapping visually.  This is a
   * prerequisite for `autonomous_dosing_enabled` to be flipped on.
   */
  doser_verified: boolean;
  /**
   * Per-channel residual liquid in ml.  Keys are channel keys from
   * dosing_config; values are remaining ml as the grower declared at
   * install (and which the safety controller decrements on each dose).
   * NULL means "not tracked yet" — safety stops being able to enforce
   * the empty-bottle guard until the grower declares.
   */
  bottle_levels: Record<string, number> | null;
  /** Per-channel original capacity (ml when full / last-refilled). */
  bottle_capacities: Record<string, number> | null;
  /** Per-channel ISO timestamp of last grower-confirmed visual check. */
  bottle_verified_at: Record<string, string> | null;
  /**
   * Where sensor readings come from for this system.
   *  - 'tuya_cloud' (default): cron-poll pulls from Tuya every 5 min.
   *  - 'home_assistant': cron-poll skips this system; readings arrive via
   *    POST /api/sensor/ingest pushed by a Home Assistant automation.
   *  - 'webhook_generic': any other push source.
   */
  device_source: string;
  /**
   * Optional per-system overrides for the pH/EC/water-temp tolerance bands.
   * NULL → fall back to crop+stage defaults in lib/tolerance.ts.
   * Shape: { ph?: MetricTarget, ec?: MetricTarget, water_temp?: MetricTarget }.
   */
  target_ranges: Record<string, unknown> | null;
};

function rowToSystem(row: Record<string, unknown>): SystemRow {
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as SystemRow["status"],
    created_at: new Date(row.created_at as string),
    archived_at: row.archived_at ? new Date(row.archived_at as string) : null,
    crop_type: row.crop_type as string,
    cultivar_id: (row.cultivar_id as string | null) ?? null,
    grow_profile: (row.grow_profile as GrowProfile | null) ?? null,
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
    autonomous_dosing_enabled: Boolean(row.autonomous_dosing_enabled),
    doser_verified: Boolean(row.doser_verified),
    bottle_levels: (row.bottle_levels as Record<string, number> | null) ?? null,
    bottle_capacities: (row.bottle_capacities as Record<string, number> | null) ?? null,
    bottle_verified_at: (row.bottle_verified_at as Record<string, string> | null) ?? null,
    target_ranges: (row.target_ranges as Record<string, unknown> | null) ?? null,
    device_source: (row.device_source as string | null) ?? "tuya_cloud",
  };
}

/**
 * Switch a system's sensor source.  Used when migrating a system from
 * Tuya cloud polling to a Home Assistant push (or back).
 */
export async function setDeviceSource(
  systemId: string,
  source: "tuya_cloud" | "home_assistant" | "webhook_generic"
): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`UPDATE systems SET device_source = ${source} WHERE id = ${systemId}`;
}

/**
 * Bottle-level bookkeeping.  Read/modify the per-system bottle_levels
 * JSONB.  Helpers are intentionally low-level — the dosing pipeline calls
 * decrementBottle after each successful dose; the chat / UI sets levels
 * via setBottleLevels.
 */
/**
 * Declare bottle levels.  Semantics:
 *   - mode='fill': grower just filled/refilled — set BOTH capacity and
 *     remaining to the same value for each channel given.  Also stamps
 *     bottle_verified_at because a fresh fill IS a verified level.
 *   - mode='current': grower is just correcting the current remaining
 *     without changing capacity (rare; use verifyBottleLevels for the
 *     proper visual-check path).
 *
 * Always MERGES with existing values for unrelated channels.
 */
export async function setBottleLevels(
  systemId: string,
  levels: Record<string, number>,
  mode: "fill" | "current" = "fill"
): Promise<void> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT bottle_levels, bottle_capacities, bottle_verified_at
    FROM systems WHERE id = ${systemId}
  `) as unknown as Array<{
    bottle_levels: Record<string, number> | null;
    bottle_capacities: Record<string, number> | null;
    bottle_verified_at: Record<string, string> | null;
  }>;
  const cur = rows[0] ?? { bottle_levels: null, bottle_capacities: null, bottle_verified_at: null };
  const nextLevels = { ...(cur.bottle_levels ?? {}), ...levels };
  const nextCapacities = mode === "fill"
    ? { ...(cur.bottle_capacities ?? {}), ...levels }
    : (cur.bottle_capacities ?? {});
  const nowIso = new Date().toISOString();
  const nextVerified = mode === "fill"
    ? {
        ...(cur.bottle_verified_at ?? {}),
        ...Object.fromEntries(Object.keys(levels).map((k) => [k, nowIso])),
      }
    : (cur.bottle_verified_at ?? {});
  await s`
    UPDATE systems SET
      bottle_levels = ${JSON.stringify(nextLevels)}::jsonb,
      bottle_capacities = ${JSON.stringify(nextCapacities)}::jsonb,
      bottle_verified_at = ${JSON.stringify(nextVerified)}::jsonb
    WHERE id = ${systemId}
  `;
}

/**
 * Sanity-check visual verification: grower reports the level they SEE
 * in the bottle right now; we compare to tracked-remaining and flag
 * the discrepancy.  Updates remaining to the grower's reported value
 * and stamps verified-at.  Returns the comparison so the caller can
 * surface it to the grower / log.
 */
export async function verifyBottleLevel(
  systemId: string,
  channel: string,
  observedMl: number
): Promise<{
  channel: string;
  observed_ml: number;
  tracked_ml: number | null;
  delta_ml: number | null;
  capacity_ml: number | null;
}> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT bottle_levels, bottle_capacities, bottle_verified_at
    FROM systems WHERE id = ${systemId}
  `) as unknown as Array<{
    bottle_levels: Record<string, number> | null;
    bottle_capacities: Record<string, number> | null;
    bottle_verified_at: Record<string, string> | null;
  }>;
  const cur = rows[0] ?? {
    bottle_levels: null,
    bottle_capacities: null,
    bottle_verified_at: null,
  };
  const tracked = cur.bottle_levels?.[channel] ?? null;
  const capacity = cur.bottle_capacities?.[channel] ?? null;
  const delta = tracked !== null ? observedMl - tracked : null;
  const nextLevels = { ...(cur.bottle_levels ?? {}), [channel]: observedMl };
  const nextVerified = {
    ...(cur.bottle_verified_at ?? {}),
    [channel]: new Date().toISOString(),
  };
  await s`
    UPDATE systems SET
      bottle_levels = ${JSON.stringify(nextLevels)}::jsonb,
      bottle_verified_at = ${JSON.stringify(nextVerified)}::jsonb
    WHERE id = ${systemId}
  `;
  return {
    channel,
    observed_ml: observedMl,
    tracked_ml: tracked,
    delta_ml: delta,
    capacity_ml: capacity,
  };
}

export async function decrementBottle(
  systemId: string,
  channel: string,
  ml: number
): Promise<{ before: number | null; after: number | null }> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`SELECT bottle_levels FROM systems WHERE id = ${systemId}`) as unknown as Array<{
    bottle_levels: Record<string, number> | null;
  }>;
  const current = rows[0]?.bottle_levels ?? null;
  if (!current || typeof current[channel] !== "number") {
    return { before: null, after: null };
  }
  const before = current[channel];
  const after = Math.max(0, before - ml);
  const next = { ...current, [channel]: after };
  await s`UPDATE systems SET bottle_levels = ${JSON.stringify(next)}::jsonb WHERE id = ${systemId}`;
  return { before, after };
}

export async function setAutonomousDosing(
  systemId: string,
  enabled: boolean
): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`UPDATE systems SET autonomous_dosing_enabled = ${enabled} WHERE id = ${systemId}`;
}

export async function setDoserVerified(
  systemId: string,
  verified: boolean
): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`UPDATE systems SET doser_verified = ${verified} WHERE id = ${systemId}`;
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
  cultivar_id?: string | null;
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
    INSERT INTO systems (id, name, crop_type, cultivar_id, growth_stage, reservoir_liters,
                         system_type, location, outdoor, ai_cycle_minutes,
                         tuya_device_id, notes, dosing_config)
    VALUES (
      ${input.id}, ${input.name},
      ${input.crop_type ?? "lettuce"},
      ${input.cultivar_id ?? null},
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
  if (patch.cultivar_id !== undefined) fields.push(["cultivar_id", patch.cultivar_id]);
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
  if (patch.grow_profile !== undefined) {
    const blob = patch.grow_profile === null ? null : JSON.stringify(patch.grow_profile);
    await s.query(
      `UPDATE systems SET grow_profile = $1::jsonb WHERE id = $2`,
      [blob, id]
    );
  }
  return getSystem(id);
}

// === Grower Memory ===

export async function addGrowerMemory(
  systemId: string,
  entry: { kind: GrowerMemoryKind; text: string; source?: string }
): Promise<number> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    INSERT INTO grower_memory (system_id, kind, text, source)
    VALUES (${systemId}, ${entry.kind}, ${entry.text}, ${entry.source ?? "grower"})
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return Number(rows[0].id);
}

export async function getGrowerMemory(
  systemId: string,
  limit = 30
): Promise<GrowerMemoryEntry[]> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, ts, kind, text, source
    FROM grower_memory
    WHERE system_id = ${systemId} AND active = TRUE
    ORDER BY ts DESC
    LIMIT ${limit}
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    ts: new Date(r.ts as string),
    kind: r.kind as GrowerMemoryKind,
    text: r.text as string,
    source: r.source as string,
  }));
}

/** Soft-delete a memory the grower retracted. Returns the number of rows hit. */
export async function deactivateGrowerMemory(
  systemId: string,
  id: number
): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`UPDATE grower_memory SET active = FALSE WHERE id = ${id} AND system_id = ${systemId}`;
}

// === Episodic memory ===

export async function addEpisode(
  systemId: string,
  episode: { status?: string | null; summary: string; decision_id?: number | null }
): Promise<number> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    INSERT INTO grow_episodes (system_id, status, summary, decision_id)
    VALUES (${systemId}, ${episode.status ?? null}, ${episode.summary}, ${episode.decision_id ?? null})
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return Number(rows[0].id);
}

export async function getRecentEpisodes(
  systemId: string,
  limit = 8
): Promise<GrowEpisode[]> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT id, ts, status, summary
    FROM grow_episodes
    WHERE system_id = ${systemId}
    ORDER BY ts DESC
    LIMIT ${limit}
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    ts: new Date(r.ts as string),
    status: (r.status as string | null) ?? null,
    summary: r.summary as string,
  }));
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
  // Hide snoozed tasks (snoozed_until > NOW) so the chat widget and the
  // dashboard list reflect "what needs attention right now".  Tasks
  // come back into view automatically once the snooze timestamp passes.
  const rows = (await s`
    SELECT id, system_id, created_at, type, priority, title, reason, payload,
           status, expires_at, completed_at, user_response, decision_id
    FROM human_tasks
    WHERE system_id = ${systemId}
      AND status = 'pending'
      AND (snoozed_until IS NULL OR snoozed_until <= NOW())
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

/**
 * Snooze a task — hide it from pending-task surfaces until `until`.
 * The grower-facing semantic: "deal with this later today".
 */
export async function snoozeTask(
  id: number,
  until: Date,
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<void> {
  await ensureSchema();
  const s = sql();
  await s`
    UPDATE human_tasks
    SET snoozed_until = ${until.toISOString()}
    WHERE id = ${id} AND system_id = ${systemId} AND status = 'pending'
  `;
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

/**
 * The latest cron-cycle assistant message we pushed to this system's chat.
 * Used by the cron-cycle handler to suppress repetitive chat-pushes — if
 * status is identical to last push AND no new task was created AND it was
 * recent, we save the decision row but skip the chat noise.  This is the
 * fix for the POC 0.3 failure mode where the brain pushed "pH is high"
 * every 2 hours for 3 days while the grower already had a pending task.
 */
export async function getLastCronChatPush(
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<{ ts: Date; status: string | null } | null> {
  await ensureSchema();
  const s = sql();
  const rows = (await s`
    SELECT ts, status FROM chat_messages
    WHERE system_id = ${systemId}
      AND source = 'cron-cycle'
      AND role = 'assistant'
    ORDER BY ts DESC
    LIMIT 1
  `) as unknown as Array<{ ts: string; status: string | null }>;
  if (rows.length === 0) return null;
  return { ts: new Date(rows[0].ts), status: rows[0].status };
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

/**
 * Has a task of this type been created in the last N hours, REGARDLESS of
 * its current status?  Used to suppress task-creation churn: e.g. the
 * brain spawned a manual_action #47, it expired, then 2h later spawned
 * #48 with the same concern.  By checking the recent-creation window
 * (not just current pending), we stop that loop.
 */
export async function hasRecentTaskOfType(
  t: TaskType,
  hoursWindow: number,
  systemId: string = DEFAULT_SYSTEM_ID
): Promise<boolean> {
  await ensureSchema();
  const s = sql();
  const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000).toISOString();
  const rows = (await s`
    SELECT 1 FROM human_tasks
    WHERE system_id = ${systemId}
      AND type = ${t}
      AND created_at > ${cutoff}
    LIMIT 1
  `) as unknown as Array<unknown>;
  return rows.length > 0;
}
