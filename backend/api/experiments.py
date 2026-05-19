"""
Experiments API — create, manage, and preview config experiments.

Endpoints:
  GET  /api/experiments                list (filterable by group_name, status)
  POST /api/experiments                create a new experiment (status=draft)
  GET  /api/experiments/{id}           get single experiment
  PATCH /api/experiments/{id}          update mutable fields
  DELETE /api/experiments/{id}         delete (draft or concluded only)
  POST /api/experiments/{id}/activate  set status=active
  POST /api/experiments/{id}/pause     set status=paused
  POST /api/experiments/{id}/conclude  set status=concluded
  GET  /api/experiments/{id}/preview   show overrides vs current base settings

Fixed-path (/preview) routes are declared BEFORE /{id} to prevent parameter capture.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.logging.setup import get_logger
from backend.system_settings.experiments import get_experiment_service

log = get_logger(__name__)

router = APIRouter(prefix="/api/experiments", tags=["experiments"])


# ── Request bodies ────────────────────────────────────────────────────────────

class CreateBody(BaseModel):
    name:           str
    group_name:     str
    overrides:      dict[str, Any]
    description:    str = ""
    rollout_pct:    int = Field(100, ge=0, le=100)
    context_filter: dict[str, Any] = {}
    dry_run:        bool = False
    expires_at:     Optional[datetime] = None
    created_by:     str = "admin"


class PatchBody(BaseModel):
    name:           Optional[str] = None
    description:    Optional[str] = None
    overrides:      Optional[dict[str, Any]] = None
    rollout_pct:    Optional[int] = Field(None, ge=0, le=100)
    context_filter: Optional[dict[str, Any]] = None
    dry_run:        Optional[bool] = None
    expires_at:     Optional[datetime] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_experiments(
    group_name: Optional[str] = Query(None),
    status:     Optional[str] = Query(None),
    limit:      int           = Query(100, ge=1, le=500),
) -> dict:
    experiments = await get_experiment_service().list_all(
        group_name=group_name, status=status, limit=limit
    )
    return {"experiments": [e.to_dict() for e in experiments], "total": len(experiments)}


@router.post("")
async def create_experiment(body: CreateBody) -> dict:
    svc = get_experiment_service()
    try:
        exp = await svc.create(
            name=body.name,
            group_name=body.group_name,
            overrides=body.overrides,
            description=body.description,
            rollout_pct=body.rollout_pct,
            context_filter=body.context_filter or {},
            dry_run=body.dry_run,
            expires_at=body.expires_at,
            created_by=body.created_by,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    return exp.to_dict()


@router.get("/{experiment_id}")
async def get_experiment(experiment_id: int) -> dict:
    exp = await get_experiment_service().get(experiment_id)
    if exp is None:
        raise HTTPException(404, f"Experiment {experiment_id} not found")
    return exp.to_dict()


@router.patch("/{experiment_id}")
async def update_experiment(experiment_id: int, body: PatchBody) -> dict:
    fields = {k: getattr(body, k) for k in body.model_fields_set}
    svc = get_experiment_service()
    try:
        exp = await svc.update(experiment_id, fields)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    if exp is None:
        raise HTTPException(404, f"Experiment {experiment_id} not found")
    return exp.to_dict()


@router.delete("/{experiment_id}")
async def delete_experiment(experiment_id: int) -> dict:
    svc = get_experiment_service()
    try:
        deleted = await svc.delete(experiment_id)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    if not deleted:
        raise HTTPException(
            409,
            "Experiment cannot be deleted — only draft or concluded experiments can be removed",
        )
    return {"deleted": True, "id": experiment_id}


@router.post("/{experiment_id}/activate")
async def activate_experiment(experiment_id: int) -> dict:
    svc = get_experiment_service()
    try:
        exp = await svc.set_status(experiment_id, "active")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    if exp is None:
        raise HTTPException(404, f"Experiment {experiment_id} not found")
    return exp.to_dict()


@router.post("/{experiment_id}/pause")
async def pause_experiment(experiment_id: int) -> dict:
    svc = get_experiment_service()
    try:
        exp = await svc.set_status(experiment_id, "paused")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    if exp is None:
        raise HTTPException(404, f"Experiment {experiment_id} not found")
    return exp.to_dict()


@router.post("/{experiment_id}/conclude")
async def conclude_experiment(experiment_id: int) -> dict:
    svc = get_experiment_service()
    try:
        exp = await svc.set_status(experiment_id, "concluded")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))
    if exp is None:
        raise HTTPException(404, f"Experiment {experiment_id} not found")
    return exp.to_dict()


@router.get("/{experiment_id}/preview")
async def preview_experiment(
    experiment_id: int,
    context:       Optional[str] = Query(None, description="JSON-encoded context dict"),
) -> dict:
    """Show what the experiment would change vs current base settings."""
    ctx: dict | None = None
    if context:
        import json as _json
        try:
            ctx = _json.loads(context)
        except Exception:
            raise HTTPException(400, "context must be a valid JSON object")

    svc = get_experiment_service()
    try:
        return await svc.preview(experiment_id, ctx)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
