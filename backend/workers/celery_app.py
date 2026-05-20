"""
Celery application factory.
Import this module to get the configured Celery instance.
"""
from celery import Celery
from backend.config import get_settings


def create_celery() -> Celery:
    settings = get_settings()

    app = Celery("scanner")

    conf: dict = dict(
        broker_url=settings.broker_url,
        result_backend=settings.result_backend,

        # Serialisation
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],

        # Timezone
        timezone="UTC",
        enable_utc=True,

        # Reliability
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,   # one task at a time per worker process

        # Result expiry — keep results for 1 hour
        result_expires=3600,

        # Beat schedule is defined in beat_schedule.py
        beat_schedule_filename="/tmp/celerybeat-schedule",
    )

    # Upstash (and any other rediss:// provider) requires explicit SSL options.
    # CERT_NONE skips certificate verification — correct for managed cloud Redis.
    if settings.broker_url.startswith("rediss://"):
        _ssl = {"ssl_cert_reqs": "CERT_NONE"}
        conf["broker_use_ssl"]       = _ssl
        conf["redis_backend_use_ssl"] = _ssl

    app.conf.update(conf)

    # Auto-discover tasks in workers package
    app.autodiscover_tasks(["backend.workers"])

    return app


celery_app = create_celery()


from celery.signals import worker_init


@worker_init.connect
def setup_settings_watcher(sender, **kwargs):
    from backend.system_settings.propagation import start_celery_config_watcher
    from backend.system_settings.service import get_settings_service
    start_celery_config_watcher(get_settings_service())
