#!/usr/bin/env python3
"""
GrowK — Intelligent Hydroponics Agent
Main Orchestrator

Sensor poll loop (every SENSOR_POLL_INTERVAL seconds) feeds the AI cycle.
AI cycle runs at most every AI_CYCLE_INTERVAL seconds, but may run sooner if
the previous decision asked for a faster re-check via `next_check_minutes`.

Usage:
    python main.py              # Run with real devices
    python main.py --mock       # Run with mock devices (for development)
    python main.py --once       # Run one cycle and exit (for testing)
"""
import asyncio
import logging
import os
import sys
from datetime import datetime
from typing import Optional

from config import config
from devices.tuya_sensor import TuyaSensor, MockSensor
from devices.jebao_doser import JebaoDoser, MockDoser
from agent.safety import SafetyController, SafetyLimits
from agent.brain import GrowKBrain
from data.store import DataStore

logging.basicConfig(
    level=getattr(logging, config.log_level),
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("growk")


class GrowKAgent:
    def __init__(self, use_mock: bool = False):
        self.use_mock = use_mock
        self.store = DataStore()

        if use_mock:
            logger.info("Starting in MOCK mode (no real hardware)")
            self.sensor = MockSensor()
            self.doser = MockDoser()
        else:
            self.sensor = TuyaSensor(
                access_id=config.tuya_access_id,
                access_secret=config.tuya_access_secret,
                device_id=config.tuya_sensor_device_id,
                api_endpoint=config.tuya_api_endpoint,
            )
            self.doser = JebaoDoser(
                username=config.jebao_username,
                password=config.jebao_password,
                region=config.jebao_region,
            )

        self.safety = SafetyController(SafetyLimits())
        self.brain = GrowKBrain(
            api_key=config.anthropic_api_key,
            model=config.claude_model,
            safety=self.safety,
        )

        self.system_profile = {
            "system_type": config.system_type,
            "reservoir_liters": config.reservoir_liters,
            "crop_type": config.crop_type,
            "cultivar_id": config.cultivar_id,  # optional registry id; "" = resolve by crop_type
            "growth_stage": "vegetative",  # TODO: track automatically
            "location": "Tel Aviv, Israel",
            "outdoor": True,
        }

        self._last_reading = None
        self._cycle_count = 0
        # Default next-check based on configured cadence (1h baseline)
        self._next_ai_run_after_seconds = config.ai_cycle_interval
        self._last_ai_run_at: Optional[datetime] = None

    async def start(self):
        logger.info("=" * 60)
        logger.info("  GrowK Agent Starting")
        logger.info(f"  Sensor: {self.sensor.name}")
        logger.info(f"  Doser:  {self.doser.name}")
        logger.info(f"  Crop:   {self.system_profile['crop_type']}")
        if self.system_profile.get('cultivar_id'):
            logger.info(f"  Cultivar: {self.system_profile['cultivar_id']}")
        logger.info(f"  Model:  {config.claude_model}")
        logger.info(f"  Mode:   {'MOCK' if self.use_mock else 'LIVE'}")
        logger.info("=" * 60)

        if not await self.sensor.connect():
            logger.error("Failed to connect sensor!")
            if not self.use_mock:
                return

        if not await self.doser.connect():
            logger.warning("Failed to connect doser — will run in monitor-only mode")

        logger.info("All systems go. Starting main loop.")

    async def run_sensor_poll(self):
        try:
            reading = await self.sensor.read()
            self._last_reading = reading
            self.store.save_reading(reading)
            logger.info(f"Sensor: {reading.summary()}")
            return reading
        except Exception as e:
            logger.error(f"Sensor poll failed: {e}")
            return None

    async def run_ai_cycle(self):
        self._cycle_count += 1
        logger.info(f"\n{'='*40}")
        logger.info(f"AI Analysis Cycle #{self._cycle_count}")
        logger.info(f"{'='*40}")

        if self._last_reading is None:
            logger.warning("No sensor data available — skipping AI cycle")
            return None

        # Maintenance: expire stale human tasks before composing prompt
        self.store.expire_old_tasks()

        recent_readings = self.store.get_recent_readings(hours=24)
        recent_actions = self.store.get_recent_actions(hours=24)
        pending_tasks = self.store.get_pending_tasks()

        decision = await self.brain.analyze_and_decide(
            current_reading=self._last_reading,
            recent_readings=recent_readings,
            system_profile=self.system_profile,
            recent_actions=recent_actions,
            available_channels=self.doser.available_channels(),
            pending_human_tasks=pending_tasks,
        )

        # Persist decision; capture id so actions/tasks can link back
        decision_id = self.store.save_decision(decision)

        logger.info(f"Status: {decision['status']}")
        logger.info(f"Analysis: {decision['analysis']}")
        if decision.get("message"):
            logger.info(f"Message: {decision['message']}")
        for concern in decision.get("concerns", []):
            logger.warning(f"Concern: {concern}")
        for blocked in decision.get("blocked_commands", []):
            logger.warning(f"BLOCKED: {blocked['command']} — {blocked['reason']}")

        # Persist new human tasks
        for task in decision.get("human_tasks", []):
            self.store.create_human_task(
                type=task["type"],
                priority=task["priority"],
                title=task["title"],
                reason=task["reason"],
                payload=task.get("payload", {}),
                expires_in_hours=task.get("expires_in_hours"),
                decision_id=decision_id,
            )

        # Execute approved commands
        for command in decision["commands"]:
            logger.info(f"Executing: {command}")
            result = await self.doser.dose(command)

            if result.success:
                self.safety.record_dose(command.channel, command.amount_ml)
                self.store.save_action(
                    channel=command.channel.value,
                    amount_ml=command.amount_ml,
                    reason=command.reason,
                    success=True,
                    ai_status=decision["status"],
                    ai_analysis=decision["analysis"],
                    decision_id=decision_id,
                )
                logger.info(f"Done: {command.channel.value} {command.amount_ml}ml")
            else:
                self.store.save_action(
                    channel=command.channel.value,
                    amount_ml=command.amount_ml,
                    reason=f"FAILED: {result.error}",
                    success=False,
                    decision_id=decision_id,
                )
                logger.error(f"Dosing failed: {result.error}")

        # Honor AI's requested re-check timing. Decisions are hourly-scale by
        # design — clamp to [5 min, 6 hours]. The AI may go shorter for critical
        # situations or longer for healthy stable systems.
        next_minutes = decision.get("next_check_minutes", 60)
        next_seconds = max(5 * 60, min(int(next_minutes) * 60, 6 * 60 * 60))
        self._next_ai_run_after_seconds = next_seconds
        logger.info(f"Next AI cycle in ~{next_seconds // 60} min "
                    f"(AI requested {next_minutes} min)")

        return decision

    async def run_loop(self):
        await self.start()

        sensor_interval = config.sensor_poll_interval
        time_since_ai = self._next_ai_run_after_seconds  # Run AI immediately

        while True:
            try:
                await self.run_sensor_poll()

                time_since_ai += sensor_interval
                if time_since_ai >= self._next_ai_run_after_seconds:
                    await self.run_ai_cycle()
                    time_since_ai = 0

                await asyncio.sleep(sensor_interval)

            except KeyboardInterrupt:
                logger.info("Shutting down...")
                break
            except Exception as e:
                logger.error(f"Main loop error: {e}", exc_info=True)
                await asyncio.sleep(10)

        await self.sensor.disconnect()
        await self.doser.disconnect()
        self.store.close()
        logger.info("GrowK Agent stopped.")

    async def run_once(self):
        await self.start()
        await self.run_sensor_poll()
        decision = await self.run_ai_cycle()

        await self.sensor.disconnect()
        await self.doser.disconnect()
        self.store.close()

        return decision


async def _run_api_server(agent: "GrowKAgent", host: str, port: int):
    """Run the FastAPI server concurrently with the agent loop."""
    import uvicorn
    from api.server import create_app

    app = create_app(agent)
    server_config = uvicorn.Config(
        app, host=host, port=port, log_level="info", access_log=False
    )
    server = uvicorn.Server(server_config)
    logger.info(f"HTTP API listening on http://{host}:{port}")
    await server.serve()


async def main():
    use_mock = "--mock" in sys.argv
    run_once = "--once" in sys.argv
    no_api = "--no-api" in sys.argv

    agent = GrowKAgent(use_mock=use_mock)

    if run_once:
        # In --once mode we don't bother starting the HTTP server.
        await agent.run_once()
        return

    # Railway injects $PORT for the public-facing port; respect it.
    api_host = os.getenv("GROWK_API_HOST", "127.0.0.1")
    api_port = int(os.getenv("PORT", os.getenv("GROWK_API_PORT", "8765")))

    if no_api:
        await agent.run_loop()
        return

    # Run the agent loop and the API server concurrently. If either crashes,
    # cancel the other so the process exits cleanly.
    loop_task = asyncio.create_task(agent.run_loop(), name="agent_loop")
    api_task = asyncio.create_task(
        _run_api_server(agent, api_host, api_port), name="api_server"
    )
    done, pending = await asyncio.wait(
        [loop_task, api_task], return_when=asyncio.FIRST_COMPLETED
    )
    for task in pending:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


if __name__ == "__main__":
    asyncio.run(main())
