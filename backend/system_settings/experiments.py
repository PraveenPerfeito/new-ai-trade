"""
Experimental configuration — staged rollouts, temporary overrides, dry-run mode.

How it works
------------
SettingsService.get_group(model, context=...) calls resolve_overrides() here.
Active experiments for the requested group are applied on top of base settings
in ID order (lowest ID first; later experiments win field conflicts).

An experiment is applied when ALL of the following hold:
  1. status = 'active'
  2. expires_at IS NULL or expires_at > NOW()
  3. context_filter is a subset of the provided context dict (or is empty)
  4. random() < rollout_pct / 100

dry_run=True: the overrides are logged but not applied.

Supported patterns
------------------
  staged_rollout     rollout_pct=10–50, activate, watch metrics, ramp up
  temporary_override expires_at set     auto-reverts without manual conclude
  paper_trading_only context_filter={"trading_context": "paper_trading"}
  dry_run_preview    dry_run=True       safe preview before committing
  feature_experiment group_name='features', overrides={"ai_validation": false}

Cache: active experiments refresh every 10 s from DB.
"""
from __future__ import annotations

import json
import logging
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from backend.logging.setup import get_logger

log = get_logger(__name__)

_CACHE_TTL = 10.0  # seconds between active-experiment cache refreshes


# ── Experiment model ──────────────────────────────────────────────────────────

@dataclass
class Experiment:
    id:             int
    name:           str
    description:    str
    group_name:     str
    overrides:      dict[str, Any]
    status:         str          # draft | active | paused | concluded
    rollout_pct:    int          # 0–100
    context_filter: dict[str, Any]
    dry_run:        bool
    expires_at:     Optional[datetime]
    created_by:     str
    created_at:     datetime
    updated_at:     datetime

    def is_live(self) -> bool:
        """Active and not yet expired."""
        if self.status != 'active':
            return False
        if self.expires_at and datetime.now(timezone.utc) >= self.expires_at:
            return False
        return True

    def matches_context(self, context: dict | None) -> bool:
        """All context_filter k/v pairs must appear in the provided context."""
        if not self.context_filter:
            return True
        if context is None:
            return False
        return all(context.get(k) == v for k, v in self.context_filter.items())

    def in_rollout(self) -> bool:
        """Probabilistic gate — non-sticky (re-evaluated each call)."""
        if self.rollout_pct >= 100:
            return True
        if self.rollout_pct <= 0:
            return False
        return random.random() < self.rollout_pct / 100

    def to_dict(self) -> dict:
        return {
            "id":             self.id,
            "name":           self.name,
            "description":    self.description,
            "group_name":     self.group_name,
            "overrides":      self.overrides,
            "status":         self.status,
            "rollout_pct":    self.rollout_pct,
            "context_filter": self.context_filter,
            "dry_run":        self.dry_run,
            "expires_at":     self.expires_at.isoformat() if self.expires_at else None,
            "created_by":     self.created_by,
            "created_at":     self.created_at.isoformat(),
            "updated_at":     self.updated_at.isoformat(),
        }


# ── Service ───────────────────────────────────────────────────────────────────

class ExperimentService:

    def __init__(self) -> None:
        self._cache:    list[Experiment] = []
        self._cache_at: float = 0.0

    # ── DB helpers ────────────────────────────────────────────────────────────

    async def _pool(self):
        try:
            from backend.database.session import get_pool
            return await get_pool()
        except Exception:
            return None

    @staticmethod
    def _from_row(row) -> Experiment:
        return Experiment(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            group_name=row["group_name"],
            overrides=dict(row["overrides"] or {}),
            status=row["status"],
            rollout_pct=row["rollout_pct"],
            context_filter=dict(row["context_filter"] or {}),
            dry_run=row["dry_run"],
            expires_at=row["expires_at"],
            created_by=row["created_by"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    # ── Active-experiment cache ───────────────────────────────────────────────

    async def _refresh(self) -> None:
        pool = await self._pool()
        if pool is None:
            return
        try:
            rows = await pool.fetch(
                """
                SELECT * FROM settings_experiments
                WHERE status = 'active'
                  AND (expires_at IS NULL OR expires_at > NOW())
                ORDER BY id
                """
            )
            self._cache    = [self._from_row(r) for r in rows]
            self._cache_at = time.monotonic()
        except Exception as exc:
            log.warning("experiments_cache_refresh_failed", error=str(exc))

    async def _live(self) -> list[Experiment]:
        if time.monotonic() - self._cache_at > _CACHE_TTL:
            await self._refresh()
        return self._cache

    def _bust(self) -> None:
        self._cache_at = 0.0

    # ── Override resolution (called by SettingsService) ───────────────────────

    async def resolve_overrides(
        self,
        group_name: str,
        base_data: dict[str, Any],
        context: dict | None = None,
    ) -> dict[str, Any]:
        """
        Apply active experiments to base_data in ID order.
        Returns base_data unchanged when no experiments match.
        """
        candidates = [e for e in await self._live() if e.group_name == group_name]
        if not candidates:
            return base_data

        merged = dict(base_data)
        applied = False

        for exp in candidates:
            if not exp.matches_context(context):
                continue
            if not exp.in_rollout():
                continue

            if exp.dry_run:
                would_change = {k: v for k, v in exp.overrides.items() if merged.get(k) != v}
                if would_change:
                    log.info(
                        "experiment_dry_run",
                        experiment_id=exp.id,
                        name=exp.name,
                        group=group_name,
                        would_change=list(would_change.keys()),
                    )
                continue

            merged.update(exp.overrides)
            applied = True
            log.debug(
                "experiment_applied",
                experiment_id=exp.id,
                name=exp.name,
                group=group_name,
                keys=list(exp.overrides.keys()),
            )

        return merged if applied else base_data

    # ── CRUD ──────────────────────────────────────────────────────────────────

    async def create(
        self,
        name: str,
        group_name: str,
        overrides: dict[str, Any],
        description: str = "",
        rollout_pct: int = 100,
        context_filter: Optional[dict] = None,
        dry_run: bool = False,
        expires_at: Optional[datetime] = None,
        created_by: str = "admin",
    ) -> Experiment:
        from backend.system_settings.groups import GROUP_REGISTRY
        model_class = GROUP_REGISTRY.get(group_name)
        if model_class is None:
            raise ValueError(f"Unknown settings group: {group_name!r}")
        valid_keys = set(model_class.defaults_dict().keys())
        bad_keys = [k for k in overrides if k not in valid_keys]
        if bad_keys:
            raise ValueError(f"Unknown fields for group {group_name!r}: {bad_keys}")

        pool = await self._pool()
        if pool is None:
            raise RuntimeError("Database unavailable")

        row = await pool.fetchrow(
            """
            INSERT INTO settings_experiments
              (name, description, group_name, overrides, rollout_pct,
               context_filter, dry_run, expires_at, created_by)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9)
            RETURNING *
            """,
            name, description, group_name,
            json.dumps(overrides),
            rollout_pct,
            json.dumps(context_filter or {}),
            dry_run, expires_at, created_by,
        )
        self._bust()
        exp = self._from_row(row)
        log.info("experiment_created", id=exp.id, name=name, group=group_name)
        return exp

    async def get(self, experiment_id: int) -> Optional[Experiment]:
        pool = await self._pool()
        if pool is None:
            return None
        row = await pool.fetchrow(
            "SELECT * FROM settings_experiments WHERE id = $1", experiment_id
        )
        return self._from_row(row) if row else None

    async def list_all(
        self,
        group_name: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
    ) -> list[Experiment]:
        pool = await self._pool()
        if pool is None:
            return []
        conditions: list[str] = []
        params: list = []
        if group_name:
            params.append(group_name)
            conditions.append(f"group_name = ${len(params)}")
        if status:
            params.append(status)
            conditions.append(f"status = ${len(params)}")
        params.append(limit)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = await pool.fetch(
            f"SELECT * FROM settings_experiments {where} ORDER BY id DESC LIMIT ${len(params)}",
            *params,
        )
        return [self._from_row(r) for r in rows]

    async def update(
        self,
        experiment_id: int,
        fields: dict[str, Any],
    ) -> Optional[Experiment]:
        """Update allowed fields. `fields` keys come from the PATCH body model_fields_set."""
        _allowed = {"name", "description", "overrides", "rollout_pct",
                    "context_filter", "dry_run", "expires_at"}
        updates = {k: v for k, v in fields.items() if k in _allowed}
        if not updates:
            return await self.get(experiment_id)

        pool = await self._pool()
        if pool is None:
            raise RuntimeError("Database unavailable")

        set_parts: list[str] = []
        params: list = []

        for col, val in updates.items():
            if col in ("overrides", "context_filter"):
                params.append(json.dumps(val or {}))
                set_parts.append(f"{col} = ${len(params)}::jsonb")
            else:
                params.append(val)
                set_parts.append(f"{col} = ${len(params)}")

        params.append(experiment_id)
        row = await pool.fetchrow(
            f"""
            UPDATE settings_experiments
            SET {', '.join(set_parts)}, updated_at = NOW()
            WHERE id = ${len(params)}
            RETURNING *
            """,
            *params,
        )
        self._bust()
        return self._from_row(row) if row else None

    async def set_status(self, experiment_id: int, new_status: str) -> Optional[Experiment]:
        _valid = {"draft", "active", "paused", "concluded"}
        if new_status not in _valid:
            raise ValueError(f"Invalid status: {new_status!r}")
        pool = await self._pool()
        if pool is None:
            raise RuntimeError("Database unavailable")
        row = await pool.fetchrow(
            """
            UPDATE settings_experiments
            SET status = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING *
            """,
            new_status, experiment_id,
        )
        self._bust()
        if row:
            log.info("experiment_status_changed", id=experiment_id, status=new_status)
        return self._from_row(row) if row else None

    async def delete(self, experiment_id: int) -> bool:
        """Delete only draft or concluded experiments."""
        pool = await self._pool()
        if pool is None:
            raise RuntimeError("Database unavailable")
        result = await pool.execute(
            "DELETE FROM settings_experiments WHERE id = $1 AND status IN ('draft', 'concluded')",
            experiment_id,
        )
        self._bust()
        return result == "DELETE 1"

    async def preview(
        self,
        experiment_id: int,
        context: dict | None = None,
    ) -> dict:
        """Show what this experiment would change vs current base settings."""
        exp = await self.get(experiment_id)
        if exp is None:
            raise ValueError(f"Experiment {experiment_id} not found")

        from backend.system_settings.service import get_settings_service
        from backend.system_settings.groups import GROUP_REGISTRY

        base_data, _ = await get_settings_service()._get_group_raw(exp.group_name)
        model_class   = GROUP_REGISTRY.get(exp.group_name)
        valid_keys    = set(model_class.defaults_dict().keys()) if model_class else None
        invalid_keys  = (
            [k for k in exp.overrides if k not in valid_keys]
            if valid_keys is not None else []
        )

        diff = {
            k: {"base": base_data.get(k), "experiment": v}
            for k, v in exp.overrides.items()
            if base_data.get(k) != v
        }
        return {
            "experiment_id":   exp.id,
            "name":            exp.name,
            "group_name":      exp.group_name,
            "status":          exp.status,
            "would_apply":     exp.is_live() and exp.matches_context(context),
            "invalid_keys":    invalid_keys,
            "diff":            diff,
            "base":            base_data,
            "with_experiment": {**base_data, **exp.overrides},
        }


# ── Singleton ─────────────────────────────────────────────────────────────────

_svc: Optional[ExperimentService] = None


def get_experiment_service() -> ExperimentService:
    global _svc
    if _svc is None:
        _svc = ExperimentService()
    return _svc
