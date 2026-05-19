"""
Analytics API — performance breakdowns, AI effectiveness, scan metrics,
paper trading history, and a realtime SSE metrics stream.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from backend.analytics.ai_metrics import get_ai_summary
from backend.analytics.paper_trading import get_or_create_portfolio, get_portfolio_metrics
from backend.analytics.performance_engine import get_dashboard_summary
from backend.analytics.realtime_metrics import sse_metrics_stream
from backend.analytics.scan_metrics import get_scan_summary
from backend.analytics.signal_metrics import get_analytics
from backend.logging.setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary")
async def dashboard_summary(
    window_hours: int = Query(default=168, ge=1, le=720),
) -> dict[str, Any]:
    """All analytics in one call — signal performance, AI, scans, paper trading."""
    return await get_dashboard_summary(window_hours)


@router.get("/performance")
async def signal_performance(
    window_hours: int = Query(default=168, ge=1, le=720),
) -> dict[str, Any]:
    """Signal outcome analytics with breakdowns by mode, grade, volatility, confidence."""
    return await get_analytics(window_hours)


@router.get("/ai")
async def ai_effectiveness(
    window_hours: int = Query(default=24, ge=1, le=168),
) -> dict[str, Any]:
    """Claude API approval rates, latency distribution, and fallback usage."""
    return await get_ai_summary(window_hours)


@router.get("/scans")
async def scan_performance(
    window_hours: int = Query(default=24, ge=1, le=168),
) -> dict[str, Any]:
    """Scan throughput, duration trends, and per-mode breakdown."""
    return await get_scan_summary(window_hours)


@router.get("/paper-trading/portfolio")
async def paper_portfolio() -> dict[str, Any]:
    """Virtual portfolio equity, cumulative PnL, win rate, and open positions."""
    result = await get_portfolio_metrics()
    if result is None:
        return {"error": "No portfolio data available — database may not be configured."}
    return result


@router.get("/paper-trading/trades")
async def paper_trades(
    limit: int  = Query(default=50, ge=1, le=200),
    status: str = Query(default="all"),
) -> dict[str, Any]:
    """Recent paper trades with optional status filter (OPEN, CLOSED_TP_HIT, etc.)."""
    from backend.database.session import get_pool
    try:
        pool = await get_pool()
    except RuntimeError:
        return {"trades": [], "total": 0, "error": "Database not configured"}

    portfolio = await get_or_create_portfolio()
    if not portfolio:
        return {"trades": [], "total": 0}

    portfolio_id = str(portfolio["id"])
    try:
        if status == "all":
            rows = await pool.fetch(
                "SELECT * FROM paper_trades WHERE portfolio_id=$1 ORDER BY created_at DESC LIMIT $2",
                portfolio_id, limit,
            )
        else:
            rows = await pool.fetch(
                "SELECT * FROM paper_trades WHERE portfolio_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT $3",
                portfolio_id, status.upper(), limit,
            )

        trades = []
        for r in rows:
            row_dict = dict(r)
            # Convert UUID/datetime to str for JSON serialisation
            for k, v in row_dict.items():
                if hasattr(v, "isoformat"):
                    row_dict[k] = v.isoformat()
                elif hasattr(v, "hex"):
                    row_dict[k] = str(v)
            trades.append(row_dict)

        return {"trades": trades, "total": len(trades)}
    except Exception as exc:
        log.warning("paper_trades_fetch_failed", error=str(exc))
        return {"trades": [], "total": 0}


@router.get("/stream")
async def metrics_stream(
    timeout: int = Query(default=300, ge=30, le=600),
) -> StreamingResponse:
    """
    Server-Sent Events stream of realtime scanner and signal events.
    Connect with EventSource('/api/analytics/stream') from the frontend.
    """
    return StreamingResponse(
        sse_metrics_stream(timeout),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection":    "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
