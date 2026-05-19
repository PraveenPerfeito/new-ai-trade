"""
Burn-in monitoring API.

Endpoints:
  GET /api/burnin/status     — current progress + live edge metrics + last anomaly check
  GET /api/burnin/snapshots  — historical snapshot list (newest first)
  GET /api/burnin/anomalies  — recent anomaly records, flattened from hourly snapshots
  GET /api/burnin/readiness  — full production readiness score + component breakdown
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from backend.analytics.burn_in import (
    get_burnin_status,
    get_snapshot_history,
    get_latest_anomalies,
)
from backend.analytics.production_readiness import compute_production_readiness
from backend.logging.setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/burnin", tags=["burnin"])


@router.get("/status")
async def burnin_status() -> dict[str, Any]:
    """
    Current burn-in progress snapshot.

    Returns data coverage, live 7-day win rate + expectancy, and the
    most recent anomaly check summary.  Fast: no heavy recomputation.
    """
    return await get_burnin_status()


@router.get("/snapshots")
async def burnin_snapshots(
    snapshot_type: str = Query(
        default="daily_edge",
        description="Snapshot type: daily_edge | daily_signal | hourly_anomaly",
    ),
    limit: int = Query(default=30, ge=1, le=200),
) -> list[dict[str, Any]]:
    """
    Historical snapshot list for a given snapshot_type, newest first.

    Use snapshot_type=daily_edge for the full 30-day edge report history.
    Use snapshot_type=hourly_anomaly to review past anomaly check results.
    """
    valid = {"daily_edge", "daily_signal", "hourly_anomaly"}
    if snapshot_type not in valid:
        return []
    return await get_snapshot_history(snapshot_type, limit)


@router.get("/anomalies")
async def burnin_anomalies(
    limit: int = Query(
        default=48,
        ge=1,
        le=200,
        description="Number of hourly_anomaly snapshots to read (each may contain multiple anomalies)",
    ),
) -> list[dict[str, Any]]:
    """
    Recent anomaly records, flattened from the last `limit` hourly snapshots.

    Each item includes anomaly_type, severity, description, metric_value,
    threshold, detected_at, and snapshot_at for the containing snapshot.
    """
    return await get_latest_anomalies(limit)


@router.get("/readiness")
async def burnin_readiness() -> dict[str, Any]:
    """
    Full production readiness assessment.

    Scores five components (operational stability, signal edge, calibration,
    AI effectiveness, data coverage) and returns an overall 0-100 score with
    a go/no-go verdict and rationale.

    This endpoint reads the latest persisted snapshots and live 24-hour metrics
    — it does not trigger a new edge validation run.
    """
    return await compute_production_readiness()
