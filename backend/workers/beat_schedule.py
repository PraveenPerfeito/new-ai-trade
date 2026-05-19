"""
Celery Beat periodic task schedule.
Replaces the globalThis scheduler singleton from lib/scheduler.ts.
"""
from celery.schedules import crontab

from backend.workers.celery_app import celery_app

celery_app.conf.beat_schedule = {
    # Auto-scan: runs every 15 minutes (same cadence as the Next.js scheduler default)
    "auto-scan-standard": {
        "task": "backend.workers.scan_task.run_scheduled_scan",
        "schedule": crontab(minute="*/15"),
        "kwargs": {"mode": "standard"},
        "options": {
            "expires": 14 * 60,  # discard if not started within 14 minutes
            "queue": "scanner",
        },
    },
    # High-confidence scan: every 30 minutes
    "auto-scan-high-confidence": {
        "task": "backend.workers.scan_task.run_scheduled_scan",
        "schedule": crontab(minute="5,35"),
        "kwargs": {"mode": "high_confidence"},
        "options": {
            "expires": 25 * 60,
            "queue": "scanner",
        },
    },
    # Futures scan: every 30 minutes, offset by 10 minutes to avoid pile-up
    "auto-scan-futures": {
        "task": "backend.workers.scan_task.run_scheduled_scan",
        "schedule": crontab(minute="10,40"),
        "kwargs": {"mode": "futures"},
        "options": {
            "expires": 25 * 60,
            "queue": "scanner",
        },
    },
    # Paper trading position checker: every minute
    "paper-trading-monitor": {
        "task": "backend.workers.scan_task.monitor_paper_positions",
        "schedule": crontab(minute="*"),
        "options": {
            "expires": 50,  # discard if not started within 50 seconds
            "queue": "paper_trading",
        },
    },
    # Signal outcome tracker: every 10 minutes
    "check-signal-outcomes": {
        "task": "backend.workers.scan_task.check_signal_outcomes",
        "schedule": crontab(minute="*/10"),
        "options": {
            "expires": 9 * 60,
            "queue": "paper_trading",
        },
    },
}
