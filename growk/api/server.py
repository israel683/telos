"""
GrowK HTTP API

FastAPI server exposing the agent's state and the Human Task Queue to the
dashboard UI. Runs in-process alongside the async control loop, sharing the
same DataStore and agent state.

Endpoints:
  GET  /api/state            — current reading + last decision + task counts
  GET  /api/readings         — sensor history
  GET  /api/decisions        — AI decision log
  GET  /api/tasks            — human tasks (filterable by status)
  POST /api/tasks/{id}/complete   — mark a task done
  POST /api/tasks/{id}/dismiss    — dismiss a task
  GET  /api/system           — system profile
  POST /api/system           — update system profile
"""
import os
import json
import logging
from datetime import datetime
from typing import Optional, TYPE_CHECKING

from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

if TYPE_CHECKING:
    from main import GrowKAgent

logger = logging.getLogger("growk.api")


# Optional bearer token. If GROWK_API_TOKEN is unset, auth is disabled (dev mode).
def _auth_dependency(authorization: Optional[str] = Header(default=None)):
    expected = os.getenv("GROWK_API_TOKEN", "").strip()
    if not expected:
        return  # dev mode — no auth
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if authorization.removeprefix("Bearer ").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid bearer token")


class TaskActionBody(BaseModel):
    response: str = ""


class SystemUpdateBody(BaseModel):
    crop_type: Optional[str] = None
    cultivar_id: Optional[str] = None
    growth_stage: Optional[str] = None
    reservoir_liters: Optional[int] = None
    system_type: Optional[str] = None


def create_app(agent: "GrowKAgent") -> FastAPI:
    app = FastAPI(title="GrowK API", version="0.1.0")

    # CORS — open in dev, restricted via env in production.
    # GROWK_CORS_ORIGINS: comma-separated exact origins (e.g. production URL).
    # GROWK_CORS_ORIGIN_REGEX: regex pattern (re.fullmatch) for dynamic preview
    # deploys (e.g. Vercel branch/per-deploy URLs that change per commit).
    cors_origins_env = os.getenv("GROWK_CORS_ORIGINS", "*")
    cors_origin_regex = os.getenv("GROWK_CORS_ORIGIN_REGEX", "").strip() or None
    cors_kwargs = {
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }
    if cors_origins_env == "*":
        cors_kwargs["allow_origins"] = ["*"]
    else:
        cors_kwargs["allow_origins"] = [
            o.strip() for o in cors_origins_env.split(",") if o.strip()
        ]
    if cors_origin_regex:
        cors_kwargs["allow_origin_regex"] = cors_origin_regex
    app.add_middleware(CORSMiddleware, **cors_kwargs)

    @app.get("/api/health")
    def health():
        return {"ok": True, "ts": datetime.now().isoformat()}

    @app.get("/api/state", dependencies=[Depends(_auth_dependency)])
    def get_state():
        last_reading = agent._last_reading
        recent_decisions = _query_recent_decisions(agent, limit=1)
        last_decision = recent_decisions[0] if recent_decisions else None
        pending = agent.store.get_pending_tasks()
        priority_counts = {"urgent": 0, "high": 0, "medium": 0, "low": 0}
        for t in pending:
            priority_counts[t.get("priority", "medium")] = (
                priority_counts.get(t.get("priority", "medium"), 0) + 1
            )

        return {
            "agent": {
                "cycle_count": agent._cycle_count,
                "next_ai_seconds": agent._next_ai_run_after_seconds,
                "mock_mode": agent.use_mock,
                "model": (last_decision or {}).get("model", None),
            },
            "current_reading": _reading_to_dict(last_reading) if last_reading else None,
            "last_decision": last_decision,
            "pending_tasks": {
                "total": len(pending),
                "by_priority": priority_counts,
            },
            "system_profile": agent.system_profile,
        }

    @app.get("/api/readings", dependencies=[Depends(_auth_dependency)])
    def get_readings(hours: int = 24, limit: int = 200):
        readings = agent.store.get_recent_readings(hours=hours, limit=limit)
        return {"readings": [_reading_to_dict(r) for r in readings]}

    @app.get("/api/decisions", dependencies=[Depends(_auth_dependency)])
    def get_decisions(limit: int = 20):
        return {"decisions": _query_recent_decisions(agent, limit=limit)}

    @app.get("/api/tasks", dependencies=[Depends(_auth_dependency)])
    def get_tasks(status: str = "pending"):
        if status == "pending":
            tasks = agent.store.get_pending_tasks()
        else:
            # Generic query for other statuses
            cur = agent.store._conn.execute(
                """SELECT * FROM human_tasks
                   WHERE system_id = ? AND status = ?
                   ORDER BY created_at DESC LIMIT 100""",
                (agent.store._system_id, status)
            )
            tasks = [_task_row_to_dict(dict(row)) for row in cur.fetchall()]
        return {"tasks": tasks}

    @app.post("/api/tasks/{task_id}/complete", dependencies=[Depends(_auth_dependency)])
    def complete_task(task_id: int, body: TaskActionBody):
        agent.store.complete_task(task_id, response=body.response or "")
        return {"ok": True}

    @app.post("/api/tasks/{task_id}/dismiss", dependencies=[Depends(_auth_dependency)])
    def dismiss_task(task_id: int, body: TaskActionBody):
        agent.store.dismiss_task(task_id, response=body.response or "")
        return {"ok": True}

    @app.get("/api/system", dependencies=[Depends(_auth_dependency)])
    def get_system():
        return agent.system_profile

    @app.post("/api/system", dependencies=[Depends(_auth_dependency)])
    def update_system(body: SystemUpdateBody):
        for field in ("crop_type", "cultivar_id", "growth_stage", "reservoir_liters", "system_type"):
            value = getattr(body, field)
            if value is not None:
                agent.system_profile[field] = value
        return {"system_profile": agent.system_profile}

    return app


def _reading_to_dict(reading) -> dict:
    if reading is None:
        return None
    return {
        "timestamp": reading.timestamp.isoformat(),
        "ph": reading.ph,
        "ec": reading.ec,
        "tds": reading.tds,
        "orp": reading.orp,
        "water_temp": reading.water_temp,
        "cf": reading.cf,
        "salinity": reading.salinity,
        "sg": reading.sg,
        "source": reading.source,
    }


def _task_row_to_dict(row: dict) -> dict:
    payload = row.get("payload")
    if isinstance(payload, str):
        try:
            row["payload"] = json.loads(payload) if payload else {}
        except (json.JSONDecodeError, TypeError):
            row["payload"] = {}
    return row


def _query_recent_decisions(agent: "GrowKAgent", limit: int = 20) -> list[dict]:
    rows = agent.store._conn.execute(
        """SELECT id, timestamp, status, analysis, message, raw_response,
                  tokens_input, tokens_output, cache_creation_tokens, cache_read_tokens
           FROM ai_decisions
           WHERE system_id = ?
           ORDER BY timestamp DESC LIMIT ?""",
        (agent.store._system_id, limit)
    ).fetchall()
    out = []
    for row in rows:
        d = dict(row)
        try:
            d["raw_response"] = json.loads(d["raw_response"]) if d["raw_response"] else {}
        except (json.JSONDecodeError, TypeError):
            d["raw_response"] = {}
        out.append(d)
    return out
