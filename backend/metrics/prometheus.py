"""
Prometheus metric registries for the scanner platform.
All metrics are created once at import time and reused across requests.
"""
from prometheus_client import Counter, Gauge, Histogram, Summary, CollectorRegistry

# Use the default registry so prometheus-fastapi-instrumentator can find them
from prometheus_client import REGISTRY as registry

# ── Scanner metrics ───────────────────────────────────────────────────────────

scan_runs_total = Counter(
    "scanner_runs_total",
    "Total number of scan runs",
    ["mode", "status"],          # status: completed | failed
)

scan_duration_seconds = Histogram(
    "scanner_duration_seconds",
    "Full scan duration from start to finish",
    ["mode"],
    buckets=[10, 30, 60, 120, 180, 300, 600],
)

coins_scanned_total = Counter(
    "scanner_coins_scanned_total",
    "Total coins evaluated across all scans",
    ["mode"],
)

signals_generated_total = Counter(
    "scanner_signals_generated_total",
    "Total trading signals that passed all gates",
    ["mode", "signal_type"],     # signal_type: BUY | SELL
)

gate_rejections_total = Counter(
    "scanner_gate_rejections_total",
    "Count of signals rejected at each pipeline gate",
    ["gate"],  # mtf | volatility | trend_strength | market_structure |
               # setup_score | rr_ratio | risk_engine | futures | ai
)

# ── AI validator metrics ──────────────────────────────────────────────────────

ai_validation_duration_seconds = Histogram(
    "ai_validation_duration_seconds",
    "Time spent waiting for Claude API response",
    buckets=[0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0],
)

ai_validation_total = Counter(
    "ai_validation_total",
    "Total AI validation calls",
    ["outcome"],                 # validated | rejected | fallback | error
)

ai_confidence_histogram = Histogram(
    "ai_confidence_score",
    "Distribution of AI confidence scores for accepted signals",
    buckets=[75, 78, 80, 82, 84, 86, 88, 90, 92, 95, 100],
)

# ── Scheduler metrics ─────────────────────────────────────────────────────────

scheduler_active = Gauge(
    "scheduler_active",
    "1 if the auto-scanner is currently scheduled, 0 if stopped",
)

scheduler_scanning = Gauge(
    "scheduler_scanning",
    "1 if a scan is currently in progress",
)

scheduler_last_scan_timestamp = Gauge(
    "scheduler_last_scan_timestamp_seconds",
    "Unix timestamp of the last completed scan",
)

# ── API metrics (supplement prometheus-fastapi-instrumentator) ────────────────

api_errors_total = Counter(
    "api_errors_total",
    "Total API errors by endpoint and status code",
    ["endpoint", "status_code"],
)

# ── External API metrics ──────────────────────────────────────────────────────

external_api_duration_seconds = Histogram(
    "external_api_duration_seconds",
    "Latency of calls to external APIs",
    ["service"],                 # binance | coingecko | anthropic | telegram
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0],
)

external_api_errors_total = Counter(
    "external_api_errors_total",
    "Total errors from external API calls",
    ["service", "error_type"],   # error_type: timeout | rate_limit | server_error | network
)

# ── Redis / cache metrics ─────────────────────────────────────────────────────

cache_hits_total = Counter(
    "cache_hits_total",
    "Total cache hits",
    ["cache_name"],
)

cache_misses_total = Counter(
    "cache_misses_total",
    "Total cache misses",
    ["cache_name"],
)

# ── Paper trading metrics ─────────────────────────────────────────────────────

paper_positions_open = Gauge(
    "paper_positions_open",
    "Number of currently open paper trading positions",
)

paper_trades_closed_total = Counter(
    "paper_trades_closed_total",
    "Total paper trades closed",
    ["exit_reason"],             # TP_HIT | SL_HIT | MANUAL | EXPIRED
)

# ── Celery task metrics ───────────────────────────────────────────────────────

celery_tasks_total = Counter(
    "celery_tasks_total",
    "Total Celery task executions",
    ["task_name", "status"],     # status: success | failure | retry
)

celery_task_duration_seconds = Histogram(
    "celery_task_duration_seconds",
    "Celery task execution time",
    ["task_name"],
    buckets=[1, 5, 30, 60, 120, 300, 600],
)
