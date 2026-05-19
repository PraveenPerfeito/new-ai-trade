"""
Settings service — DB-backed runtime configuration with layered caching.

Cache hierarchy (fastest → authoritative):
  1. In-memory dict         — 30 s TTL, zero I/O
  2. Redis key              — 1 h TTL, shared across workers
  3. PostgreSQL             — source of truth

On every write:
  - DB row is upserted
  - Audit log row is inserted
  - Redis key is deleted (cache bust)
  - In-memory TTL is reset (next read reloads)
  - "settings_changed" Redis pub/sub channel is published

On startup call seed_defaults() once so all keys exist in the DB.
"""
from __future__ import annotations

import json
import time
from typing import Any, Optional

from backend.cache.redis_cache import get_redis
from backend.logging.setup import get_logger
from backend.system_settings.definitions import (
    ALL_DEFINITIONS,
    DEFINITIONS_BY_CATEGORY,
    DEFINITIONS_BY_KEY,
    SettingDef,
)

log = get_logger(__name__)

_REDIS_KEY   = "settings:snapshot"
_MEM_TTL     = 30       # seconds — in-process cache TTL
_REDIS_TTL   = 3600     # seconds — cross-worker cache TTL


class SettingsService:

    def __init__(self) -> None:
        self._mem: dict[str, Any] = {}       # key -> current value
        self._mem_loaded_at: float = 0.0

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _mem_stale(self) -> bool:
        return (time.monotonic() - self._mem_loaded_at) > _MEM_TTL

    async def _pool(self):
        try:
            from backend.database.session import get_pool
            return await get_pool()
        except Exception as exc:
            log.warning("settings_db_unavailable", error=str(exc))
            return None

    async def _load_from_db(self) -> dict[str, Any]:
        pool = await self._pool()
        if pool is None:
            return {}
        try:
            rows = await pool.fetch("SELECT key, value FROM system_settings")
            return {row["key"]: row["value"] for row in rows}
        except Exception as exc:
            log.warning("settings_db_load_failed", error=str(exc))
            return {}

    async def _refresh_mem(self) -> None:
        """Repopulate in-memory cache from Redis or DB."""
        try:
            redis = await get_redis()
            raw = await redis.get(_REDIS_KEY)
            if raw:
                self._mem = json.loads(raw)
                self._mem_loaded_at = time.monotonic()
                return
        except Exception:
            pass
        db_values = await self._load_from_db()
        self._mem = db_values
        self._mem_loaded_at = time.monotonic()
        try:
            redis = await get_redis()
            await redis.setex(_REDIS_KEY, _REDIS_TTL, json.dumps(self._mem, default=str))
        except Exception:
            pass

    async def _invalidate(self) -> None:
        self._mem_loaded_at = 0.0
        try:
            redis = await get_redis()
            await redis.delete(_REDIS_KEY)
            await redis.publish("settings_changed", "1")
        except Exception:
            pass

    @staticmethod
    def _coerce(defn: SettingDef, value: Any) -> Any:
        if defn.data_type == 'bool':
            if isinstance(value, str):
                return value.lower() not in ('false', '0', 'no', '')
            return bool(value)
        if defn.data_type == 'int':
            return int(value)
        if defn.data_type == 'float':
            return float(value)
        return str(value)

    # ── Public read API ───────────────────────────────────────────────────────

    async def get(self, key: str) -> Any:
        """Return current value for key, or the definition default."""
        if self._mem_stale():
            await self._refresh_mem()
        defn = DEFINITIONS_BY_KEY.get(key)
        if defn is None:
            return None
        return self._mem.get(key, defn.default)

    async def get_all(self) -> dict[str, list[dict]]:
        """Return all settings grouped by category, each merged with definition metadata."""
        if self._mem_stale():
            await self._refresh_mem()
        result: dict[str, list[dict]] = {}
        for defn in ALL_DEFINITIONS:
            result.setdefault(defn.category, []).append({
                "key":             defn.key,
                "category":        defn.category,
                "data_type":       defn.data_type,
                "label":           defn.label,
                "description":     defn.description,
                "value":           self._mem.get(defn.key, defn.default),
                "default":         defn.default,
                "min_val":         defn.min_val,
                "max_val":         defn.max_val,
                "allowed_values":  defn.allowed_values,
                "requires_restart":defn.requires_restart,
            })
        return result

    async def get_category(self, category: str) -> list[dict]:
        all_settings = await self.get_all()
        return all_settings.get(category, [])

    # ── Public write API ──────────────────────────────────────────────────────

    async def set_value(self, key: str, value: Any, updated_by: str = "admin") -> None:
        defn = DEFINITIONS_BY_KEY.get(key)
        if defn is None:
            raise ValueError(f"Unknown setting key: {key!r}")
        value = self._coerce(defn, value)
        old_value = await self.get(key)

        pool = await self._pool()
        if pool is None:
            raise RuntimeError("Database unavailable — cannot persist setting")

        await pool.execute(
            """
            INSERT INTO system_settings (category, key, value, updated_by)
            VALUES ($1, $2, $3::jsonb, $4)
            ON CONFLICT (key) DO UPDATE
              SET value      = EXCLUDED.value,
                  updated_at = NOW(),
                  updated_by = EXCLUDED.updated_by
            """,
            defn.category, key, json.dumps(value, default=str), updated_by,
        )
        await pool.execute(
            """
            INSERT INTO settings_audit_log (category, key, old_value, new_value, updated_by)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
            """,
            defn.category, key,
            json.dumps(old_value, default=str),
            json.dumps(value, default=str),
            updated_by,
        )
        await self._invalidate()
        log.info("setting_updated", key=key, old=old_value, new=value, by=updated_by)

    async def set_many(self, updates: dict[str, Any], updated_by: str = "admin") -> None:
        for key, value in updates.items():
            await self.set_value(key, value, updated_by)

    async def reset_to_defaults(
        self, category: str | None = None, updated_by: str = "admin"
    ) -> None:
        defs = DEFINITIONS_BY_CATEGORY.get(category, []) if category else ALL_DEFINITIONS
        for defn in defs:
            await self.set_value(defn.key, defn.default, updated_by)

    async def seed_defaults(self) -> None:
        """Insert default values for any keys not yet in the DB. Safe to call on every startup."""
        pool = await self._pool()
        if pool is None:
            log.warning("settings_seed_skipped_no_db")
            return
        try:
            for defn in ALL_DEFINITIONS:
                await pool.execute(
                    """
                    INSERT INTO system_settings (category, key, value, updated_by)
                    VALUES ($1, $2, $3::jsonb, 'system')
                    ON CONFLICT (key) DO NOTHING
                    """,
                    defn.category, defn.key, json.dumps(defn.default, default=str),
                )
            await self._invalidate()
            log.info("settings_seeded", count=len(ALL_DEFINITIONS))
        except Exception as exc:
            log.warning("settings_seed_failed", error=str(exc))

    # ── Audit log ─────────────────────────────────────────────────────────────

    async def get_audit_log(
        self, limit: int = 50, category: Optional[str] = None
    ) -> list[dict]:
        pool = await self._pool()
        if pool is None:
            return []
        try:
            if category:
                rows = await pool.fetch(
                    "SELECT * FROM settings_audit_log WHERE category=$1 ORDER BY updated_at DESC LIMIT $2",
                    category, limit,
                )
            else:
                rows = await pool.fetch(
                    "SELECT * FROM settings_audit_log ORDER BY updated_at DESC LIMIT $1",
                    limit,
                )
            return [
                {
                    "id":         row["id"],
                    "category":   row["category"],
                    "key":        row["key"],
                    "old_value":  row["old_value"],
                    "new_value":  row["new_value"],
                    "updated_by": row["updated_by"],
                    "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
                }
                for row in rows
            ]
        except Exception as exc:
            log.warning("settings_audit_log_failed", error=str(exc))
            return []


# ── Module-level singleton ────────────────────────────────────────────────────

_service: Optional[SettingsService] = None


def get_settings_service() -> SettingsService:
    global _service
    if _service is None:
        _service = SettingsService()
    return _service
