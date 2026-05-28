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
            # Discard if not started within 13 min — keeps task queue clean and
            # ensures a queued task never fires after the distributed lock (11-min TTL)
            # has already expired (which would cause a duplicate scan).
            "expires": 13 * 60,
            "queue": "scanner",
        },
    },
    # High-confidence scan: every 30 minutes
    "auto-scan-high-confidence": {
        "task": "backend.workers.scan_task.run_scheduled_scan",
        "schedule": crontab(minute="5,35"),
        "kwargs": {"mode": "high_confidence"},
        "options": {
            "expires": 13 * 60,
            "queue": "scanner",
        },
    },
    # Futures scan: every 30 minutes, offset by 10 minutes to avoid pile-up
    "auto-scan-futures": {
        "task": "backend.workers.scan_task.run_scheduled_scan",
        "schedule": crontab(minute="10,40"),
        "kwargs": {"mode": "futures"},
        "options": {
            "expires": 13 * 60,
            "queue": "scanner",
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
