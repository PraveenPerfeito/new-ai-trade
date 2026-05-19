"""
Admin settings API.

Endpoints:
  GET  /api/settings          — all settings grouped by category
  GET  /api/settings/audit    — audit log of recent changes
  GET  /api/settings/{cat}    — settings for one category
  PUT  /api/settings/{cat}/{key} — update a single setting
  POST /api/settings/bulk     — update many settings at once
  POST /api/settings/reset    — reset one category (or all) to defaults
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.logging.setup import get_logger
from backend.system_settings.service import get_settings_service

log = get_logger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ── Request models ────────────────────────────────────────────────────────────

class UpdateBody(BaseModel):
    value: Any
    updated_by: str = "admin"


class BulkUpdateBody(BaseModel):
    updates: dict[str, Any]
    updated_by: str = "admin"


class ResetBody(BaseModel):
    category: Optional[str] = None
    updated_by: str = "admin"


# ── Endpoints — fixed paths MUST come before /{category} ─────────────────────

@router.get("/audit")
async def get_audit_log(
    limit:    int            = Query(50, ge=1, le=500),
    category: Optional[str] = Query(None),
) -> dict:
    svc = get_settings_service()
    entries = await svc.get_audit_log(limit=limit, category=category)
    return {"entries": entries}


@router.post("/bulk")
async def bulk_update(body: BulkUpdateBody) -> dict:
    svc = get_settings_service()
    try:
        await svc.set_many(body.updates, body.updated_by)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"success": True, "updated": list(body.updates.keys())}


@router.post("/reset")
async def reset_to_defaults(body: ResetBody) -> dict:
    svc = get_settings_service()
    try:
        await svc.reset_to_defaults(body.category, body.updated_by)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"success": True, "category": body.category or "all"}


# ── Parametric paths ──────────────────────────────────────────────────────────

@router.get("")
async def list_all_settings() -> dict:
    svc = get_settings_service()
    return await svc.get_all()


@router.get("/{category}")
async def list_category_settings(category: str) -> list:
    svc = get_settings_service()
    result = await svc.get_category(category)
    if not result:
        raise HTTPException(status_code=404, detail=f"Category {category!r} not found")
    return result


@router.put("/{category}/{key}")
async def update_setting(category: str, key: str, body: UpdateBody) -> dict:
    svc = get_settings_service()
    try:
        await svc.set_value(key, body.value, body.updated_by)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return {"success": True, "key": key, "value": body.value}
