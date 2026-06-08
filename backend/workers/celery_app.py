"""
Celery application factory.
Import this module to get the configured Celery instance.
"""
import ssl

from celery import Celery
from backend.config import get_settings
from backend.logging.setup import configure_logging
from backend.workers.beat_schedule import BEAT_SCHEDULE

configure_logging()


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
        broker_connection_retry_on_startup=True,

        # Result expiry — keep results for 1 hour
        result_expires=3600,

        # Explicit task module imports (autodiscover only finds 'tasks.py' by default)
        imports=[
            "backend.workers.scan_task",
            "backend.workers.analytics_tasks",
        ],

        # Periodic task schedule
        beat_schedule=BEAT_SCHEDULE,
        beat_schedule_filename="/tmp/celerybeat-schedule",
    )

    # Upstash (and any other rediss:// provider) requires explicit SSL options.
    # CERT_NONE skips certificate verification — correct for managed cloud Redis.
    # Broker and result backend are checked independently so switching the broker
    # to AMQP (REDIS.FIX.2) still correctly enables SSL for the Redis result backend.
    if settings.broker_url.startswith("rediss://"):
        # ssl.CERT_NONE is the integer constant (0); the string "CERT_NONE" is rejected by redis-py ≥ 5.x
        conf["broker_use_ssl"] = {"ssl_cert_reqs": ssl.CERT_NONE}
    if settings.result_backend and settings.result_backend.startswith("rediss://"):
        conf["redis_backend_use_ssl"] = {"ssl_cert_reqs": ssl.CERT_NONE}

    app.conf.update(conf)

    return app


celery_app = create_celery()


from celery.signals import worker_init, worker_ready


@worker_init.connect
def setup_settings_watcher(sender, **kwargs):
    from backend.logging.setup import configure_logging
    configure_logging()
    from backend.system_settings.propagation import start_celery_config_watcher
    from backend.system_settings.service import get_settings_service
    start_celery_config_watcher(get_settings_service())


@worker_ready.connect
def start_health_check_server(sender, **kwargs):
    """Start HTTP health server so Railway web-service health checks pass."""
    from backend.workers.health_server import start_health_server
    start_health_server()
    # P3.1: Write initial heartbeat so /health/ready reports worker as alive immediately
    from backend.workers.scan_task import write_worker_heartbeat
    write_worker_heartbeat()
