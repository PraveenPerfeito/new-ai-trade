"""
Celery Beat periodic task schedule.
Replaces the globalThis scheduler singleton from lib/scheduler.ts.
Imported by celery_app.py so the schedule is always registered.
"""
from celery.schedules import crontab

BEAT_SCHEDULE = {
    # Auto-scan: runs every 15 minutes (same cadence as the Next.js scheduler default)
    "auto-scan-standard": {
        "task": "backend.workers.scan_task.run_scheduled_scan",
        "schedule": crontab(minute="*/15"),
        "kwargs": {"mode": "standard"},
        "options": {
            # Discard if not started within 17 min — matches soft_time_limit so a delayed
            # queued task still has a full 17 min to run before expiry discards it.
            "expires": 17 * 60,
            "queue": "celery",
        },
    },
    # High-confidence scan: every 30 minutes
    "auto-scan-high-confidence": {
        "task": "backend.workers.scan_task.run_scheduled_scan",
        "schedule": crontab(minute="5,35"),
        "kwargs": {"mode": "high_confidence"},
        "options": {
            "expires": 17 * 60,
            "queue": "celery",
        },
    },
    # Futures scan: every 30 minutes, offset by 10 minutes to avoid pile-up
    "auto-scan-futures": {
        "task": "backend.workers.scan_task.run_scheduled_scan",
        "schedule": crontab(minute="10,40"),
        "kwargs": {"mode": "futures"},
        "options": {
            "expires": 17 * 60,
            "queue": "celery",
        },
    },
    # Trending scan: every 30 minutes — populates trend_score + sector_status (INTEL.PERSIST.1)
    "auto-scan-trending": {
        "task": "backend.workers.scan_task.run_scheduled_scan",
        "schedule": crontab(minute="20,50"),
        "kwargs": {"mode": "trending"},
        "options": {
            "expires": 17 * 60,
            "queue": "celery",
        },
    },
    # Signal outcome tracker: every 30 minutes — signals resolve over hours so
    # 30-min resolution has no meaningful impact on outcome tracking accuracy.
    # Saves 96 msgs/day vs */10 cadence (A1 OPS.CONSOLIDATION.1, 2,880/month).
    "check-signal-outcomes": {
        "task": "backend.workers.scan_task.check_signal_outcomes",
        "schedule": crontab(minute="*/30"),
        "options": {
            "expires": 28 * 60,   # discard if not started within 28 min
            "queue": "celery",
        },
    },
    # ── Analytics burn-in ─────────────────────────────────────────────────────
    # Daily edge validation + 7-day signal summary: 23:59 UTC
    "daily-analytics-snapshot": {
        "task": "backend.workers.analytics_tasks.daily_analytics_snapshot",
        "schedule": crontab(hour="23", minute="59"),
        "options": {
            "expires": 11 * 60,   # discard if worker is down for the night
            "queue": "celery",
        },
    },
    # Anomaly check: every 2 hours — anomalies are surfaced via dashboard polling
    # on demand; sub-hour detection latency adds no operational value.
    # Saves 12 msgs/day vs hourly cadence (A1 OPS.CONSOLIDATION.1, 360/month).
    "hourly-anomaly-check": {
        "task": "backend.workers.analytics_tasks.hourly_anomaly_check",
        "schedule": crontab(minute="0", hour="*/2"),
        "options": {
            "expires": 55 * 60,   # discard if not started within 55 min of scheduled time
            "queue": "celery",
        },
    },
    # Worker liveness heartbeat: every 240 seconds — _HEARTBEAT_TTL is 600s,
    # so a 240s interval gives 2.5× safety margin before /health/ready reports
    # "unknown".  Reduces heartbeat to 360 msgs/day (was 720 at 120s — A1
    # OPS.CONSOLIDATION.1 saves 10,800 msgs/month).
    "worker-heartbeat": {
        "task": "backend.workers.scan_task.worker_heartbeat",
        "schedule": 240.0,  # seconds (was 120.0 — A1 OPS.CONSOLIDATION.1)
        "options": {
            "expires": 235,
            "queue": "celery",
        },
    },
    # Refresh mv_daily_outcome_summary after midnight data lands: 00:05 UTC
    "refresh-daily-view": {
        "task": "backend.workers.analytics_tasks.refresh_daily_view",
        "schedule": crontab(hour="0", minute="5"),
        "options": {
            "expires": 55 * 60,
            "queue": "celery",
        },
    },
}
