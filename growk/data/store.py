"""
GrowK Data Store

SQLite-based storage for sensor readings, dosing actions, AI decisions,
and the Human Task Queue (tasks the agent asks the human to perform).

Schema includes `system_id` from the start so we can extend to multiple
hydroponic systems without a migration. POC default is 'default'.
"""
import json
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import Optional

from devices.base import WaterReading

logger = logging.getLogger("growk.data")


# Task types the AI can create for the human
TASK_TYPES = {"water_change", "dose_approval", "system_reset", "question", "manual_action"}
TASK_PRIORITIES = {"low", "medium", "high", "urgent"}
TASK_STATUSES = {"pending", "done", "dismissed", "expired"}


class DataStore:
    def __init__(self, db_path: Optional[str] = None, system_id: str = "default"):
        # In production (Railway) we mount a persistent volume at /app/data and
        # set DB_PATH=/app/data/growk.db. Locally we fall back to a cwd file.
        import os
        self._db_path = db_path or os.getenv("DB_PATH", "growk_data.db")
        # Ensure parent dir exists (Railway volume mount, fresh container, etc.)
        parent = os.path.dirname(self._db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._system_id = system_id
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _init_db(self):
        # check_same_thread=False so the API server (which runs sync handlers in
        # a worker thread) can read from the same DB the agent loop writes to.
        # SQLite serialized mode handles cross-thread access; our workload is
        # write-light (one decision per ~15 min) so contention is negligible.
        self._conn = sqlite3.connect(self._db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA journal_mode = WAL")  # better concurrent reads

        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS sensor_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                system_id TEXT NOT NULL DEFAULT 'default',
                timestamp TEXT NOT NULL,
                ph REAL, ec REAL, tds REAL, orp REAL,
                water_temp REAL, cf REAL, salinity REAL, sg REAL,
                source TEXT
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS dosing_actions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                system_id TEXT NOT NULL DEFAULT 'default',
                timestamp TEXT NOT NULL,
                channel TEXT NOT NULL,
                amount_ml REAL NOT NULL,
                reason TEXT,
                success INTEGER,
                ai_status TEXT,
                ai_analysis TEXT,
                decision_id INTEGER
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                system_id TEXT NOT NULL DEFAULT 'default',
                timestamp TEXT NOT NULL,
                status TEXT,
                analysis TEXT,
                message TEXT,
                raw_response TEXT,
                tokens_input INTEGER,
                tokens_output INTEGER,
                cache_creation_tokens INTEGER,
                cache_read_tokens INTEGER
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS human_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                system_id TEXT NOT NULL DEFAULT 'default',
                created_at TEXT NOT NULL,
                type TEXT NOT NULL,
                priority TEXT NOT NULL,
                title TEXT NOT NULL,
                reason TEXT NOT NULL,
                payload TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                expires_at TEXT,
                completed_at TEXT,
                user_response TEXT,
                decision_id INTEGER,
                FOREIGN KEY (decision_id) REFERENCES ai_decisions(id)
            )
        """)

        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_readings_ts "
            "ON sensor_readings(system_id, timestamp DESC)"
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_actions_ts "
            "ON dosing_actions(system_id, timestamp DESC)"
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_decisions_ts "
            "ON ai_decisions(system_id, timestamp DESC)"
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_status "
            "ON human_tasks(system_id, status, priority)"
        )

        self._migrate()
        self._conn.commit()

    def _migrate(self):
        # Best-effort idempotent migrations for older DBs created before this schema.
        migrations = [
            "ALTER TABLE sensor_readings ADD COLUMN system_id TEXT NOT NULL DEFAULT 'default'",
            "ALTER TABLE dosing_actions ADD COLUMN system_id TEXT NOT NULL DEFAULT 'default'",
            "ALTER TABLE dosing_actions ADD COLUMN decision_id INTEGER",
            "ALTER TABLE ai_decisions ADD COLUMN system_id TEXT NOT NULL DEFAULT 'default'",
            "ALTER TABLE ai_decisions ADD COLUMN tokens_input INTEGER",
            "ALTER TABLE ai_decisions ADD COLUMN tokens_output INTEGER",
            "ALTER TABLE ai_decisions ADD COLUMN cache_creation_tokens INTEGER",
            "ALTER TABLE ai_decisions ADD COLUMN cache_read_tokens INTEGER",
        ]
        for sql in migrations:
            try:
                self._conn.execute(sql)
            except sqlite3.OperationalError:
                pass  # Column already exists

    # === Sensor readings ===

    def save_reading(self, reading: WaterReading):
        self._conn.execute(
            """INSERT INTO sensor_readings
               (system_id, timestamp, ph, ec, tds, orp, water_temp, cf, salinity, sg, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (self._system_id, reading.timestamp.isoformat(), reading.ph, reading.ec,
             reading.tds, reading.orp, reading.water_temp,
             reading.cf, reading.salinity, reading.sg, reading.source)
        )
        self._conn.commit()

    def get_recent_readings(self, hours: int = 24, limit: int = 200) -> list[WaterReading]:
        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
        rows = self._conn.execute(
            """SELECT * FROM sensor_readings
               WHERE system_id = ? AND timestamp > ?
               ORDER BY timestamp DESC LIMIT ?""",
            (self._system_id, cutoff, limit)
        ).fetchall()

        readings = []
        for row in reversed(rows):  # Chronological order
            readings.append(WaterReading(
                timestamp=datetime.fromisoformat(row["timestamp"]),
                ph=row["ph"], ec=row["ec"], tds=row["tds"],
                orp=row["orp"], water_temp=row["water_temp"],
                cf=row["cf"], salinity=row["salinity"], sg=row["sg"],
                source=row["source"] or "unknown"
            ))
        return readings

    # === Dosing actions ===

    def save_action(self, channel: str, amount_ml: float, reason: str,
                    success: bool, ai_status: str = "", ai_analysis: str = "",
                    decision_id: Optional[int] = None):
        self._conn.execute(
            """INSERT INTO dosing_actions
               (system_id, timestamp, channel, amount_ml, reason, success,
                ai_status, ai_analysis, decision_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (self._system_id, datetime.now().isoformat(), channel, amount_ml, reason,
             1 if success else 0, ai_status, ai_analysis, decision_id)
        )
        self._conn.commit()

    def get_recent_actions(self, hours: int = 24) -> list[dict]:
        cutoff = (datetime.now() - timedelta(hours=hours)).isoformat()
        rows = self._conn.execute(
            """SELECT * FROM dosing_actions
               WHERE system_id = ? AND timestamp > ?
               ORDER BY timestamp""",
            (self._system_id, cutoff,)
        ).fetchall()
        return [dict(row) for row in rows]

    # === AI decisions ===

    def save_decision(self, decision: dict) -> int:
        cur = self._conn.execute(
            """INSERT INTO ai_decisions
               (system_id, timestamp, status, analysis, message, raw_response,
                tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (self._system_id, datetime.now().isoformat(),
             decision.get("status", ""),
             decision.get("analysis", ""),
             decision.get("message", ""),
             json.dumps(decision.get("raw_response", {}), ensure_ascii=False),
             decision.get("tokens_input", 0),
             decision.get("tokens_output", 0),
             decision.get("cache_creation_tokens", 0),
             decision.get("cache_read_tokens", 0))
        )
        self._conn.commit()
        return cur.lastrowid

    # === Human Task Queue ===

    def create_human_task(
        self, *, type: str, priority: str, title: str, reason: str,
        payload: Optional[dict] = None, expires_in_hours: Optional[float] = None,
        decision_id: Optional[int] = None,
    ) -> int:
        if type not in TASK_TYPES:
            raise ValueError(f"Invalid task type: {type}. Must be one of {TASK_TYPES}")
        if priority not in TASK_PRIORITIES:
            raise ValueError(f"Invalid priority: {priority}")

        expires_at = None
        if expires_in_hours is not None:
            expires_at = (datetime.now() + timedelta(hours=expires_in_hours)).isoformat()

        cur = self._conn.execute(
            """INSERT INTO human_tasks
               (system_id, created_at, type, priority, title, reason, payload,
                status, expires_at, decision_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
            (self._system_id, datetime.now().isoformat(), type, priority, title, reason,
             json.dumps(payload or {}, ensure_ascii=False), expires_at, decision_id)
        )
        self._conn.commit()
        task_id = cur.lastrowid
        logger.info(f"Human task created: #{task_id} [{priority}] {type}: {title}")
        return task_id

    def get_pending_tasks(self) -> list[dict]:
        rows = self._conn.execute(
            """SELECT * FROM human_tasks
               WHERE system_id = ? AND status = 'pending'
               ORDER BY
                 CASE priority
                   WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                   WHEN 'medium' THEN 2 WHEN 'low' THEN 3
                 END,
                 created_at""",
            (self._system_id,)
        ).fetchall()
        result = []
        for row in rows:
            d = dict(row)
            try:
                d["payload"] = json.loads(d["payload"]) if d["payload"] else {}
            except (json.JSONDecodeError, TypeError):
                d["payload"] = {}
            result.append(d)
        return result

    def has_pending_task_of_type(self, task_type: str) -> bool:
        row = self._conn.execute(
            """SELECT 1 FROM human_tasks
               WHERE system_id = ? AND status = 'pending' AND type = ? LIMIT 1""",
            (self._system_id, task_type)
        ).fetchone()
        return row is not None

    def complete_task(self, task_id: int, response: str = ""):
        self._conn.execute(
            """UPDATE human_tasks
               SET status = 'done', completed_at = ?, user_response = ?
               WHERE id = ? AND system_id = ?""",
            (datetime.now().isoformat(), response, task_id, self._system_id)
        )
        self._conn.commit()
        logger.info(f"Human task #{task_id} completed")

    def dismiss_task(self, task_id: int, response: str = ""):
        self._conn.execute(
            """UPDATE human_tasks
               SET status = 'dismissed', completed_at = ?, user_response = ?
               WHERE id = ? AND system_id = ?""",
            (datetime.now().isoformat(), response, task_id, self._system_id)
        )
        self._conn.commit()
        logger.info(f"Human task #{task_id} dismissed")

    def expire_old_tasks(self) -> int:
        now = datetime.now().isoformat()
        cur = self._conn.execute(
            """UPDATE human_tasks
               SET status = 'expired'
               WHERE system_id = ? AND status = 'pending'
                 AND expires_at IS NOT NULL AND expires_at < ?""",
            (self._system_id, now)
        )
        self._conn.commit()
        n = cur.rowcount
        if n > 0:
            logger.info(f"Expired {n} stale human tasks")
        return n

    def close(self):
        if self._conn:
            self._conn.close()
