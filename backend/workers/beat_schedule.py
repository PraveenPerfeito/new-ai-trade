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
    # Signal outcome tracker: every 10 minutes
    "check-signal-outcomes": {
        "task": "backend.workers.scan_task.check_signal_outcomes",
        "schedule": crontab(minute="*/10"),
        "options": {
            "expires": 9 * 60,
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
    # Hourly anomaly check: at the top of every hour
    "hourly-anomaly-check": {
        "task": "backend.workers.analytics_tasks.hourly_anomaly_check",
        "schedule": crontab(minute="0"),
        "options": {
            "expires": 55 * 60,
            "queue": "celery",
        },
    },
    # Worker liveness heartbeat: every 120 seconds — /health/ready threshold is
    # 300s, so a 120s interval gives 2.5× safety margin before "unknown" is
    # reported.  Halves CloudAMQP heartbeat traffic (~720 msgs/day saved).
    "worker-heartbeat": {
        "task": "backend.workers.scan_task.worker_heartbeat",
        "schedule": 120.0,  # seconds (was 60.0 — R2 OPS.CONSOLIDATION.1)
        "options": {
            "expires": 115,
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
