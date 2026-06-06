"""
Settings service — layered cache in front of settings_groups table.

Cache hierarchy (fastest → authoritative):
  1. In-process dict   30 s TTL — zero I/O, single-process fast path
  2. Redis             1 h TTL  — shared across Uvicorn workers / Celery
  3. PostgreSQL        source of truth, written on every change

Write protocol:
  1. Validate merged data through Pydantic model
  2. Upsert settings_groups (data_version atomically incremented in SQL)
  3. Insert settings_group_audit with field-level diff
  4. Delete Redis keys for that group (cache bust)
  5. Evict in-memory entry
  6. Publish "settings_changed" Redis pub/sub channel

The module exposes get_settings_service() as a process-level singleton.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Optional, TypeVar

from backend.cache.redis_cache import get_redis
from backend.logging.setup import get_logger
from backend.system_settings.groups import (
    ALL_GROUPS,
    GROUP_REGISTRY,
    BaseSettingsGroup,
    FieldMeta,
)
from backend.system_settings.safety import SafetyError, check_safety

log = get_logger(__name__)

T = TypeVar('T', bound=BaseSettingsGroup)

_MEM_TTL            = 60       # seconds (was 30 — settings change rarely; 60s cuts refresh ops by half)
_REDIS_TTL          = 3_600    # 1 hour
_GEN_CHECK_INTERVAL = 60.0     # seconds between generation counter checks (was 30.0 — aligned with MEM_TTL)


# ── Cache entry ───────────────────────────────────────────────────────────────

@dataclass
class _CacheEntry:
    data:       dict[str, Any]
    version:    int
    loaded_at:  float


# ── Service ───────────────────────────────────────────────────────────────────

class SettingsService:

    def __init__(self) -> None:
        self._mem:          dict[str, _CacheEntry] = {}
        self._gen_check_at: float = 0.0
        self._last_gen:     str   = ""

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _pool(self):
        try:
            from backend.database.session import get_pool
            return await get_pool()
        except Exception as exc:
            log.warning("settings_db_unavailable", error=str(exc))
            return None

    def _is_stale(self, entry: _CacheEntry) -> bool:
        return (time.monotonic() - entry.loaded_at) > _MEM_TTL

    async def _check_generation(self) -> None:
        """Flush the in-process cache if the global generation counter changed."""
        now = time.monotonic()
        if now - self._gen_check_at < _GEN_CHECK_INTERVAL:
            return
        self._gen_check_at = now
        try:
            redis = await get_redis()
            gen = await redis.get("settings:generation") or "0"
            if gen != self._last_gen:
                self._last_gen = gen
                self._mem.clear()
        except Exception:
            pass

    async def _load_from_db(self, group_name: str) -> tuple[dict, int] | None:
        pool = await self._pool()
        if pool is None:
            return None
        try:
            row = await pool.fetchrow(
                "SELECT data, data_version FROM settings_groups WHERE group_name = $1",
                group_name,
            )
            if row:
                # asyncpg returns JSONB columns as raw strings — parse them
                raw = row["data"]
                return (json.loads(raw) if isinstance(raw, str) else raw), row["data_version"]
            return None
        except Exception as exc:
            log.warning("settings_load_failed", group=group_name, error=str(exc))
            return None

    async def _get_group_raw(self, group_name: str) -> tuple[dict[str, Any], int]:
        """
        Return (field_values_dict, data_version).
        Values are merged: model defaults ← DB overrides.
        Version is 0 if the group has never been written.
        """
        await self._check_generation()

        model_class = GROUP_REGISTRY.get(group_name)
        defaults = model_class.defaults_dict() if model_class else {}

        # 1. In-memory cache
        entry = self._mem.get(group_name)
        if entry and not self._is_stale(entry):
            return entry.data, entry.version

        # 2. Redis
        try:
            redis = await get_redis()
            raw  = await redis.get(f"settings:d:{group_name}")
            ver  = await redis.get(f"settings:v:{group_name}")
            if raw and ver:
                data = {**defaults, **json.loads(raw)}
                version = int(ver)
                self._mem[group_name] = _CacheEntry(data=data, version=version,
                                                     loaded_at=time.monotonic())
                return data, version
        except Exception:
            pass

        # 3. DB
        db_result = await self._load_from_db(group_name)
        if db_result:
            db_data, version = db_result
            data = {**defaults, **db_data}
        else:
            data, version = defaults, 0

        # Populate caches
        self._mem[group_name] = _CacheEntry(data=data, version=version,
                                             loaded_at=time.monotonic())
        try:
            redis = await get_redis()
            await redis.setex(f"settings:d:{group_name}", _REDIS_TTL,
                              json.dumps(data, default=str))
            await redis.setex(f"settings:v:{group_name}", _REDIS_TTL, str(version))
        except Exception:
            pass

        return data, version

    async def _invalidate(self, group_name: str) -> None:
        """Bust caches and notify other workers."""
        self._mem.pop(group_name, None)
        try:
            redis = await get_redis()
            await redis.delete(f"settings:d:{group_name}", f"settings:v:{group_name}")
            await redis.incr("settings:generation")
            await redis.expire("settings:generation", 86_400)
            await redis.publish("settings_changed", group_name)
        except Exception:
            pass

    # ── Public read API ───────────────────────────────────────────────────────

    async def _apply_experiments(
        self,
        group_name: str,
        data: dict[str, Any],
        context: dict | None,
    ) -> dict[str, Any]:
        """Apply active experiment overrides (no-op if none configured)."""
        try:
            from backend.system_settings.experiments import get_experiment_service
            return await get_experiment_service().resolve_overrides(group_name, data, context)
        except Exception:
            return data

    async def get_group(self, model_class: type[T], context: dict | None = None) -> T:
        """Return a typed, fully-validated settings instance with experiment overrides applied."""
        data, _ = await self._get_group_raw(model_class.GROUP_NAME)
        data = await self._apply_experiments(model_class.GROUP_NAME, data, context)
        try:
            return model_class.model_validate(data)
        except Exception:
            log.warning("group_validation_failed_using_defaults",
                        group=model_class.GROUP_NAME)
            return model_class()

    async def get_version(self, group_name: str) -> int:
        _, version = await self._get_group_raw(group_name)
        return version

    async def get_all_groups(self) -> dict[str, dict]:
        """
        Return all groups in a format ready for the settings API:
        { group_name: { meta: {...}, fields: [SettingEntry, ...] } }
        """
        # Fetch DB meta for all groups in one query
        pool = await self._pool()
        db_meta: dict[str, dict] = {}
        if pool:
            try:
                rows = await pool.fetch(
                    """
                    SELECT group_name, schema_version, data_version,
                           updated_at, updated_by
                    FROM settings_groups
                    """
                )
                for r in rows:
                    db_meta[r["group_name"]] = {
                        "schema_version": r["schema_version"],
                        "data_version":   r["data_version"],
                        "updated_at":     r["updated_at"].isoformat()
                                          if r["updated_at"] else None,
                        "updated_by":     r["updated_by"],
                    }
            except Exception:
                pass

        result: dict[str, dict] = {}
        for model_class in ALL_GROUPS:
            name = model_class.GROUP_NAME
            data, _ = await self._get_group_raw(name)
            gm = db_meta.get(name, {})

            fields = []
            for fm in model_class.fields_meta():
                fields.append({
                    "key":              fm.key,
                    "category":         name,   # kept for frontend compat
                    "data_type":        fm.data_type,
                    "label":            fm.label,
                    "description":      fm.description,
                    "value":            data.get(fm.key, fm.default),
                    "default":          fm.default,
                    "min_val":          fm.min_val,
                    "max_val":          fm.max_val,
                    "allowed_values":   fm.allowed_values,
                    "requires_restart": fm.requires_restart,
                })

            result[name] = {
                "meta": {
                    "group_name":     name,
                    "schema_version": gm.get("schema_version", model_class.SCHEMA_VERSION),
                    "data_version":   gm.get("data_version", 0),
                    "updated_at":     gm.get("updated_at"),
                    "updated_by":     gm.get("updated_by", "system"),
                },
                "fields": fields,
            }
        return result

    # ── Public write API ──────────────────────────────────────────────────────

    async def patch_group(
        self,
        group_name: str,
        fields: dict[str, Any],
        updated_by: str = "admin",
    ) -> dict:
        """
        Merge `fields` into the current group data, validate through Pydantic,
        then persist atomically. Returns {"data_version": N, "changed": [...keys]}.
        Raises ValueError on validation failure, RuntimeError if DB unavailable.
        """
        model_class = GROUP_REGISTRY.get(group_name)
        if model_class is None:
            raise ValueError(f"Unknown settings group: {group_name!r}")

        current_data, current_version = await self._get_group_raw(group_name)
        merged = {**current_data, **fields}

        # Tier 1+2 safety checks — errors block, warnings are collected
        violations = check_safety(group_name, merged)
        errors = [v for v in violations if v.severity == "error"]
        if errors:
            raise SafetyError(errors)
        warning_messages = [v.message for v in violations if v.severity == "warning"]

        # Pydantic cross-field validation
        try:
            validated = model_class.model_validate(merged)
        except Exception as exc:
            raise ValueError(str(exc)) from exc

        new_data = validated.model_dump()
        changed_fields: dict[str, dict] = {
            k: {"old": current_data.get(k), "new": v}
            for k, v in new_data.items()
            if current_data.get(k) != v
        }
        if not changed_fields:
            return {"data_version": current_version, "changed": [], "warnings": warning_messages}

        pool = await self._pool()
        if pool is None:
            raise RuntimeError("Database unavailable — cannot persist settings")

        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO settings_groups
                      (group_name, schema_version, data_version, data, updated_by)
                    VALUES ($1, $2, 1, $3::jsonb, $4)
                    ON CONFLICT (group_name) DO UPDATE SET
                      schema_version = EXCLUDED.schema_version,
                      data_version   = settings_groups.data_version + 1,
                      data           = EXCLUDED.data,
                      updated_at     = NOW(),
                      updated_by     = EXCLUDED.updated_by
                    RETURNING data_version
                    """,
                    group_name,
                    model_class.SCHEMA_VERSION,
                    json.dumps(new_data, default=str),
                    updated_by,
                )
                new_version: int = row["data_version"]

                await conn.execute(
                    """
                    INSERT INTO settings_group_audit
                      (group_name, old_version, new_version, changed_fields, schema_version, updated_by)
                    VALUES ($1, $2, $3, $4::jsonb, $5, $6)
                    """,
                    group_name,
                    current_version,
                    new_version,
                    json.dumps(changed_fields, default=str),
                    model_class.SCHEMA_VERSION,
                    updated_by,
                )

        await self._invalidate(group_name)
        log.info(
            "group_patched",
            group=group_name,
            version=new_version,
            changed=list(changed_fields.keys()),
            by=updated_by,
        )
        return {
            "data_version": new_version,
            "changed":      list(changed_fields.keys()),
            "warnings":     warning_messages,
        }

    async def update_group(
        self, model: BaseSettingsGroup, updated_by: str = "admin"
    ) -> dict:
        """Replace the entire group with a pre-validated model instance."""
        return await self.patch_group(model.GROUP_NAME, model.model_dump(), updated_by)

    async def reset_group(
        self, group_name: str, updated_by: str = "admin"
    ) -> dict:
        """Reset group to model-defined defaults."""
        model_class = GROUP_REGISTRY.get(group_name)
        if model_class is None:
            raise ValueError(f"Unknown settings group: {group_name!r}")
        return await self.patch_group(
            group_name, model_class.defaults_dict(), updated_by
        )

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def seed_defaults(self) -> None:
        """
        Insert default values for any group not yet in settings_groups.
        Safe to call on every startup — existing rows are left untouched.
        """
        pool = await self._pool()
        if pool is None:
            log.warning("settings_seed_skipped_no_db")
            return
        try:
            for model_class in ALL_GROUPS:
                await pool.execute(
                    """
                    INSERT INTO settings_groups
                      (group_name, schema_version, data, updated_by)
                    VALUES ($1, $2, $3::jsonb, 'system')
                    ON CONFLICT (group_name) DO NOTHING
                    """,
                    model_class.GROUP_NAME,
                    model_class.SCHEMA_VERSION,
                    json.dumps(model_class.defaults_dict(), default=str),
                )
            log.info("settings_seeded", groups=len(ALL_GROUPS))
        except Exception as exc:
            log.warning("settings_seed_failed", error=str(exc))

    # ── Audit ─────────────────────────────────────────────────────────────────

    async def get_audit_log(
        self,
        limit: int = 50,
        group_name: Optional[str] = None,
    ) -> list[dict]:
        pool = await self._pool()
        if pool is None:
            return []
        try:
            if group_name:
                rows = await pool.fetch(
                    """
                    SELECT * FROM settings_group_audit
                    WHERE group_name = $1
                    ORDER BY updated_at DESC LIMIT $2
                    """,
                    group_name, limit,
                )
            else:
                rows = await pool.fetch(
                    "SELECT * FROM settings_group_audit ORDER BY updated_at DESC LIMIT $1",
                    limit,
                )
            return [
                {
                    "id":             row["id"],
                    "group_name":     row["group_name"],
                    "old_version":    row["old_version"],
                    "new_version":    row["new_version"],
                    "changed_fields": row["changed_fields"],
                    "schema_version": row["schema_version"],
                    "updated_by":     row["updated_by"],
                    "updated_at":     row["updated_at"].isoformat()
                                      if row["updated_at"] else None,
                }
                for row in rows
            ]
        except Exception as exc:
            log.warning("settings_audit_log_failed", error=str(exc))
            return []


# ── Singleton ─────────────────────────────────────────────────────────────────

_service: Optional[SettingsService] = None


def get_settings_service() -> SettingsService:
    global _service
    if _service is None:
        _service = SettingsService()
    return _service
