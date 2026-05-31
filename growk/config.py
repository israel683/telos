"""
GrowK Configuration
Loads settings from environment variables / .env file
"""
import os
from dataclasses import dataclass, field
from dotenv import load_dotenv

# override=True so .env wins over a stale empty shell var (e.g., Claude Desktop
# pre-sets ANTHROPIC_API_KEY=""). Production typically has no .env file, so
# hosting-provided env vars are unaffected.
load_dotenv(override=True)


@dataclass
class Config:
    # Claude API
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    claude_model: str = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

    # Tuya
    tuya_access_id: str = os.getenv("TUYA_ACCESS_ID", "")
    tuya_access_secret: str = os.getenv("TUYA_ACCESS_SECRET", "")
    tuya_api_endpoint: str = os.getenv("TUYA_API_ENDPOINT", "https://openapi.tuyaeu.com")
    tuya_sensor_device_id: str = os.getenv("TUYA_SENSOR_DEVICE_ID", "")

    # Jebao / Gizwits
    jebao_username: str = os.getenv("JEBAO_USERNAME", "")
    jebao_password: str = os.getenv("JEBAO_PASSWORD", "")
    # app_id retained for compat; JebaoDoser hardcodes the real Jebao Aqua app_id.
    gizwits_app_id: str = os.getenv("GIZWITS_APP_ID", "")
    jebao_region: str = os.getenv("JEBAO_REGION", "eu")

    # Timing
    sensor_poll_interval: int = int(os.getenv("SENSOR_POLL_INTERVAL", "30"))
    # Default 1h. Sampling is fast (every 30s); decisions are hourly-scale.
    # The AI's `next_check_minutes` overrides this downward (or upward, up to 6h).
    ai_cycle_interval: int = int(os.getenv("AI_CYCLE_INTERVAL", "3600"))

    # System profile
    system_type: str = os.getenv("SYSTEM_TYPE", "nft_wall_mounted")
    reservoir_liters: int = int(os.getenv("RESERVOIR_LITERS", "60"))
    crop_type: str = os.getenv("CROP_TYPE", "lettuce")
    # Optional cultivar id from the registry (growk/cultivars/), e.g.
    # "basilico-genovese-dop". When set, the Brain reasons at cultivar level; when
    # empty, it resolves crop_type against the registry, then the legacy fallback.
    cultivar_id: str = os.getenv("CULTIVAR_ID", "")

    log_level: str = os.getenv("LOG_LEVEL", "INFO")


config = Config()
