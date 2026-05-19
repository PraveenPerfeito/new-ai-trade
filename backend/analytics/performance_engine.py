"""
Aggregated performance engine — combines signal analytics, AI metrics,
scan performance, and paper trading into a single dashboard payload.
All data fetches run concurrently via asyncio.gather().
"""
from __future__ import annotations

import asyncio

from backend.analytics.ai_metrics import get_ai_summary
from backend.analytics.paper_trading import get_portfolio_metrics
from backend.analytics.scan_metrics import get_scan_summary
from backend.analytics.signal_metrics import get_analytics
from backend.logging.setup import get_logger

log = get_logger(__name__)


async def get_dashboard_summary(window_hours: int = 168) -> dict:
    """
    Fetch all analytics in parallel and return a unified dashboard payload.
    Individual failures return None rather than aborting the whole response.
    """
    results = await asyncio.gather(
        get_analytics(window_hours),
        get_ai_summary(min(window_hours, 24)),
        get_scan_summary(min(window_hours, 24)),
        get_portfolio_metrics(),
        return_exceptions=True,
    )

    signal_data, ai_data, scan_data, paper_data = results

    return {
        "window_hours":     window_hours,
        "signal_performance": signal_data if not isinstance(signal_data, Exception) else None,
        "ai_effectiveness":   ai_data     if not isinstance(ai_data,     Exception) else None,
        "scan_performance":   scan_data   if not isinstance(scan_data,   Exception) else None,
        "paper_trading":      paper_data  if not isinstance(paper_data,  Exception) else None,
    }
