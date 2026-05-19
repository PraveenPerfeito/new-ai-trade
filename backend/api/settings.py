"""
Admin settings API — strongly-typed group endpoints.

Endpoints:
  GET  /api/settings                    all groups with meta + field definitions
  GET  /api/settings/audit              recent audit log
  GET  /api/settings/{group}            single group
  GET  /api/settings/{group}/version    lightweight ETag check
  PATCH /api/settings/{group}           merge + validate specific fields
  PUT   /api/settings/{group}           replace entire group (full validation)
  POST  /api/settings/{group}/reset     reset group to model defaults
  POST  /api/settings/reset/all         reset every group to defaults

Fixed paths (/audit, /reset/all) are declared BEFORE /{group} so FastAPI
matches them as literals rather than parameter captures.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.logging.setup import get_logger
from backend.system_settings.groups import GROUP_REGISTRY
from backend.system_settings.service import get_settings_service

log = get_logger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ── Request bodies ────────────────────────────────────────────────────────────

class PatchBody(BaseModel):
    fields: dict[str, Any]
    updated_by: str = "admin"


class PutBody(BaseModel):
    data: dict[str, Any]
    updated_by: str = "admin"


class ResetBody(BaseModel):
    updated_by: str = "admin"


# ── Fixed-path endpoints (must precede /{group}) ──────────────────────────────

@router.get("")
async def list_all_groups() -> dict:
    """All settings groups with field metadata and current values."""
    return await get_settings_service().get_all_groups()


@router.get("/audit")
async def get_audit_log(
    limit:      int            = Query(50, ge=1, le=500),
    group_name: Optional[str] = Query(None),
) -> dict:
    """Recent configuration changes, newest first."""
    entries = await get_settings_service().get_audit_log(
        limit=limit, group_name=group_name
    )
    return {"entries": entries}


@router.post("/reset/all")
async def reset_all_groups(body: ResetBody) -> dict:
    """Reset every group to model-defined defaults."""
    svc = get_settings_service()
    results = {}
    for name in GROUP_REGISTRY:
        try:
            results[name] = await svc.reset_group(name, body.updated_by)
        except Exception as exc:
            results[name] = {"error": str(exc)}
    return {"success": True, "results": results}


# ── Parametric group endpoints ────────────────────────────────────────────────

@router.get("/{group}")
async def get_group(group: str) -> dict:
    """Single group with meta, field definitions, and current values."""
    all_groups = await get_settings_service().get_all_groups()
    if group not in all_groups:
        raise HTTPException(404, f"Settings group {group!r} not found")
    return all_groups[group]


@router.get("/{group}/version")
async def get_group_version(group: str) -> dict:
    """Lightweight ETag — returns only the current data_version integer."""
    if group not in GROUP_REGISTRY:
        raise HTTPException(404, f"Settings group {group!r} not found")
    version = await get_settings_service().get_version(group)
    return {"group_name": group, "data_version": version}


@router.patch("/{group}")
async def patch_group(group: str, body: PatchBody) -> dict:
    """
    Merge specific fields into the group, validate the full model, persist.
    Ideal for per-field saves from the UI (send just the changed field).
    """
    if group not in GROUP_REGISTRY:
        raise HTTPException(404, f"Settings group {group!r} not found")
    svc = get_settings_service()
    try:
        result = await svc.patch_group(group, body.fields, body.updated_by)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    return {"success": True, **result}


@router.put("/{group}")
async def replace_group(group: str, body: PutBody) -> dict:
    """
    Replace the entire group with a full data payload.
    All fields must be present; partial payloads should use PATCH.
    """
    if group not in GROUP_REGISTRY:
        raise HTTPException(404, f"Settings group {group!r} not found")
    model_class = GROUP_REGISTRY[group]
    svc = get_settings_service()
    try:
        validated = model_class.model_validate(body.data)
        result = await svc.update_group(validated, body.updated_by)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    return {"success": True, **result}


@router.post("/{group}/reset")
async def reset_group(group: str, body: ResetBody) -> dict:
    """Reset one group to its model-defined defaults."""
    if group not in GROUP_REGISTRY:
        raise HTTPException(404, f"Settings group {group!r} not found")
    svc = get_settings_service()
    try:
        result = await svc.reset_group(group, body.updated_by)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    return {"success": True, **result}
