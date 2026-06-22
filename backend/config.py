from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the project root from this file's location so pydantic-settings
# finds .env regardless of the process working directory (e.g. uvicorn --reload
# subprocess on Windows loses CWD context).
_ROOT      = Path(__file__).resolve().parent.parent
_ENV       = str(_ROOT / ".env")
_ENV_LOCAL = str(_ROOT / ".env.local")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_ENV, _ENV_LOCAL),  # .env.local overrides .env when both exist
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ───────────────────────────────────────────────────────────
    environment: Literal["development", "production", "test"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_log_level(cls, v: object) -> object:
        return v.upper() if isinstance(v, str) else v
    fastapi_port: int = 8000

    # ── Supabase / Postgres ───────────────────────────────────────────────────
    next_public_supabase_url: str
    next_public_supabase_anon_key: str
    # Direct Postgres URL for asyncpg (bypasses Supabase REST layer)
    database_url: str = ""          # postgres://user:pass@host:5432/db

    # ── Redis ─────────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = ""     # defaults to redis_url if not set
    celery_result_backend: str = "" # defaults to redis_url if not set

    # ── Anthropic ─────────────────────────────────────────────────────────────
    anthropic_api_key: str = ""

    # ── Binance ───────────────────────────────────────────────────────────────
    binance_api_key: str = ""
    binance_secret_key: str = ""

    # ── CoinMarketCap ─────────────────────────────────────────────────────────
    coinmarketcap_api_key: str = ""

    # ── CoinGecko (fallback) ──────────────────────────────────────────────────
    coingecko_api_key: str = ""

    # ── WhatsApp (UltraMsg) ───────────────────────────────────────────────────
    whatsapp_api_url: str = ""        # e.g. https://api.ultramsg.com/instance181885/
    whatsapp_token: str = ""          # UltraMsg instance token
    whatsapp_phone: str = ""          # recipient number with country code e.g. +919876543210

    # ── Telegram (deprecated — replaced by WhatsApp) ──────────────────────────
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # ── CORS ─────────────────────────────────────────────────────────────────
    # Stored as str to avoid pydantic-settings v2 eagerly JSON-parsing list fields.
    # Use .get_cors_origins() wherever a list is needed.
    cors_origins: str = "http://localhost:3000"

    def get_cors_origins(self) -> list[str]:
        v = self.cors_origins.strip()
        if v.startswith("["):
            import json
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                pass
        return [o.strip() for o in v.split(",") if o.strip()]

    # ── Frontend URL (used by Python backend to trigger intelligence refresh) ──
    next_app_url: str = ""           # e.g. https://your-app.vercel.app

    # ── Admin auth ────────────────────────────────────────────────────────────
    admin_secret: str = ""          # shared secret: Next.js proxy → FastAPI

    # ── Scanner defaults ──────────────────────────────────────────────────────
    scanner_delay_ms: int = 300
    scanner_min_confidence_alert: int = 85

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.redis_url

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
