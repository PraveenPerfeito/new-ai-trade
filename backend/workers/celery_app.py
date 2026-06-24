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
        task_ignore_result=True,        # no code reads task results (CLAUDE.md #29); skip result backend writes
        worker_prefetch_multiplier=1,   # one task at a time per worker process
        worker_concurrency=1,           # 1 child keeps Railway Redis connections within Essentials 30-connection limit
        broker_connection_retry_on_startup=True,

        # Explicit task module imports (autodiscover only finds 'tasks.py' by default)
        imports=[
            "backend.workers.scan_task",
            "backend.workers.analytics_tasks",
        ],

        # Periodic task schedule
        beat_schedule=BEAT_SCHEDULE,
        beat_schedule_filename="/tmp/celerybeat-schedule",
    )

    # Redis Cloud (and any other rediss:// provider) requires explicit SSL options.
    # CERT_NONE skips certificate verification — correct for managed cloud Redis.
    # Broker and result backend are checked independently so switching the broker
    # to AMQP (REDIS.FIX.2) still correctly enables SSL for the Redis result backend.
    if settings.broker_url.startswith("rediss://"):
        # ssl.CERT_NONE is the integer constant (0); the string "CERT_NONE" is rejected by redis-py ≥ 5.x
        conf["broker_use_ssl"] = {"ssl_cert_reqs": ssl.CERT_NONE}
    if settings.result_backend and settings.result_backend.startswith("rediss://"):
        conf["redis_backend_use_ssl"] = {"ssl_cert_reqs": ssl.CERT_NONE}

    # Redis broker: increase BLPOP poll timeout to 30s so the worker waits up to 30s
    # before re-polling when the queue is idle.  Reduces Redis ops from ~86K/day to
    # ~2,880/day (~97% reduction) while adding at most 30s latency on manual scans.
    # Scheduled tasks (every 15 min) are completely unaffected.
    # broker_pool_limit=1: forces connection reuse rather than opening new sockets on
    # retry — prevents the cascade where "max clients reached" triggers rapid reconnects
    # that each open new connections before closing failed ones.
    if settings.broker_url.startswith(("redis://", "rediss://")):
        conf["broker_transport_options"] = {
            "socket_timeout": 30,
            "socket_keepalive": True,
        }
        conf["broker_pool_limit"] = 1

    # AMQP broker (CloudAMQP): reconnect backoff + disable gossip traffic.
    # Without backoff, Celery retries 5×/second on connection failure → burns
    # CloudAMQP's 1M monthly quota in minutes (the reconnect-storm incident).
    # Gossip heartbeats (default: every 2s per worker) add ~86,400 msgs/day with
    # 2 workers — alone exceeding the free plan limit. Task events add another
    # ~2,400/day. Disabling both drops usage to ~24,000 msgs/month (task delivery
    # only — 2.4% of the free plan limit).
    # The --without-gossip and --without-mingle flags MUST also be set in the
    # Railway worker start command (config options don't control the gossip daemon).
    if settings.broker_url.startswith(("amqp://", "amqps://")):
        conf["broker_transport_options"] = {
            "max_retries": 10,
            "interval_start": 2,    # first retry after 2s
            "interval_step": 2,     # add 2s per subsequent retry
            "interval_max": 30,     # cap at 30s between retries
        }
        conf["broker_connection_max_retries"] = 10
        conf["worker_send_task_events"] = False   # disables task lifecycle event messages to celeryev
        conf["task_send_sent_event"] = False       # disables task-sent event messages

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
