from functools import lru_cache
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),   # .env.local overrides .env if both exist
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ───────────────────────────────────────────────────────────
    environment: Literal["development", "production", "test"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
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

    # ── CoinGecko ─────────────────────────────────────────────────────────────
    coingecko_api_key: str = ""

    # ── Telegram ─────────────────────────────────────────────────────────────
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # ── CORS ─────────────────────────────────────────────────────────────────
    cors_origins: list[str] = ["http://localhost:3000"]

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
