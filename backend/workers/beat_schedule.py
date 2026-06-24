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
    # high_confidence scan removed — mode permanently OFF (high_confidence_mode_enabled=False
    # default since dd10788; P0 audit: 26.8% WR 30d, 0/9 wins last week; saves 1,440 msgs/month)

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
    # Worker liveness heartbeat: every 600 seconds (10 min).
    # _HEARTBEAT_TTL is 1800s; /health/ready threshold is 900s.
    # Safety margin: 900s threshold / 600s interval = 1.5× (one missed fire before "unknown").
    # CloudAMQP: 6 msgs/hour = 4,320 msgs/month (was 10,800 at 240s — A2 PLATFORM.TRUTH.1).
    "worker-heartbeat": {
        "task": "backend.workers.scan_task.worker_heartbeat",
        "schedule": 600.0,  # seconds (was 240.0 — A2 PLATFORM.TRUTH.1)
        "options": {
            "expires": 590,
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
    # ATTRIBUTION.SNAPSHOTS.1 — nightly per-dimension outcome aggregation: 00:15 UTC
    # (~12 SQL queries/night; +1 CloudAMQP msg/day — negligible vs OPS budgets)
    "attribution-snapshots-nightly": {
        "task": "backend.workers.analytics_tasks.compute_attribution_snapshots",
        "schedule": crontab(hour="0", minute="15"),
        "options": {
            "expires": 55 * 60,
            "queue": "celery",
        },
    },
    # CMC.REMOVAL.IMPLEMENTATION.1 — nightly coin rankings + sector perf refresh: 01:00 UTC
    # Reads Redis cache:intel:listings (already populated by TS workers) → coin_rankings_history.
    # Updates cmc_sectors market performance from CoinGecko. Never overwrites coins[].
    # Cost: 0 CMC credits (reads Redis only; CoinGecko is free). ~1 msg/day CloudAMQP.
    "refresh-cmc-backup-nightly": {
        "task": "backend.workers.scan_task.refresh_cmc_backup",
        "schedule": crontab(hour="1", minute="0"),
        "options": {
            "expires": 3600,
            "queue": "celery",
        },
    },
    # Weekly sector membership heartbeat: Sunday 02:00 UTC (~4 msgs/month CloudAMQP)
    "refresh-sector-membership-weekly": {
        "task": "backend.workers.scan_task.refresh_sector_membership",
        "schedule": crontab(day_of_week="0", hour="2", minute="0"),
        "options": {
            "expires": 7200,
            "queue": "celery",
        },
    },
}
