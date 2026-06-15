"""
Runtime-configurable setting definitions.

Each SettingDef describes one tuneable parameter stored in system_settings.
Defaults mirror the hardcoded constants in anomaly_detector.py,
production_readiness.py, and config.py so the DB can override them at runtime.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SettingDef:
    category:        str
    key:             str
    data_type:       str          # 'bool' | 'int' | 'float' | 'string' | 'enum'
    label:           str
    description:     str
    default:         Any
    min_val:         float | None = None
    max_val:         float | None = None
    allowed_values:  list[str] | None = None
    requires_restart: bool = False


ALL_DEFINITIONS: list[SettingDef] = [

    # ── Scanner ───────────────────────────────────────────────────────────────
    SettingDef('scanner', 'scanner_delay_ms',             'int',   'Scan Delay (ms)',           'Delay between individual coin scans to avoid rate limits', 300,   0,    5000),
    SettingDef('scanner', 'scanner_min_confidence',       'int',   'Minimum Confidence',        'Signals below this confidence are discarded',              75,    50,   100),
    SettingDef('scanner', 'scanner_alert_confidence',     'int',   'Alert Confidence',          'Minimum confidence for Telegram alerts and paper trades',  85,    50,   100),
    SettingDef('scanner', 'scanner_max_coins_per_run',    'int',   'Max Coins Per Run',         'Cap on coins scanned per scheduler cycle',                 100,   10,   500),
    SettingDef('scanner', 'scanner_volume_spike_threshold','float','Volume Spike Threshold',    'Min volume ratio vs 20-candle average to pass gate',       2.0,   1.0,  10.0),
    SettingDef('scanner', 'scanner_rsi_oversold',         'int',   'RSI Oversold Level',        'RSI below this level qualifies as oversold',               35,    10,   50),
    SettingDef('scanner', 'scanner_rsi_overbought',       'int',   'RSI Overbought Level',      'RSI above this level qualifies as overbought',             65,    50,   90),

    # ── Signals ───────────────────────────────────────────────────────────────
    SettingDef('signals', 'signal_min_rr_ratio',          'float', 'Min Risk/Reward Ratio',     'Signals with RR below this are rejected',                 1.5,   0.5,  10.0),
    SettingDef('signals', 'signal_max_sl_pct',            'float', 'Max Stop-Loss %',           'Maximum allowed stop-loss as fraction of entry price',    0.08,  0.01, 0.30),
    SettingDef('signals', 'signal_confidence_high',       'int',   'High Confidence Threshold', 'Confidence level classified as high',                     85,    60,   100),
    SettingDef('signals', 'signal_confidence_medium',     'int',   'Medium Confidence Threshold','Confidence level classified as medium',                  75,    50,   100),
    SettingDef('signals', 'signal_reject_f_grade',        'bool',  'Reject F-Grade Signals',    'Automatically discard grade-F risk signals without AI',    True),

    # ── AI ────────────────────────────────────────────────────────────────────
    SettingDef('ai', 'ai_validation_enabled', 'bool',  'AI Validation Enabled', 'Enable Claude Haiku validation step',                          True),
    SettingDef('ai', 'ai_model',              'enum',  'Claude Model',          'Anthropic model used for signal validation',                   'claude-haiku-4-5',
               allowed_values=['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6']),
    SettingDef('ai', 'ai_max_tokens',         'int',   'Max Response Tokens',   'Token limit for Claude validation response',                   500,   50,  2000),
    SettingDef('ai', 'ai_temperature',        'float', 'Temperature',           'Sampling temperature — lower = more deterministic',           0.3,   0.0,  1.0),
    SettingDef('ai', 'ai_timeout_secs',       'int',   'Request Timeout (s)',   'Seconds before Claude API call times out',                     20,    5,    120),
    SettingDef('ai', 'ai_fallback_on_error',  'bool',  'Fallback on Error',     'Use heuristic fallback when Claude API fails',                 True),

    # ── Telegram ──────────────────────────────────────────────────────────────
    SettingDef('telegram', 'telegram_alerts_enabled',        'bool', 'Alerts Enabled',         'Send signal alerts via Telegram',                       True),
    SettingDef('telegram', 'telegram_min_confidence',        'int',  'Min Alert Confidence',   'Only alert on signals at or above this confidence',     85,  50, 100),
    SettingDef('telegram', 'telegram_max_alerts_per_hour',   'int',  'Max Alerts / Hour',      'Rate-limit on outgoing Telegram signal alerts',         10,   1,  100),
    SettingDef('telegram', 'telegram_daily_summary_enabled', 'bool', 'Daily Summary Enabled',  'Send a daily performance summary message',              True),
    SettingDef('telegram', 'telegram_daily_summary_hour_utc','int',  'Summary Hour (UTC)',      'Hour of day (UTC) to send the daily summary',           8,   0,   23),
    SettingDef('telegram', 'telegram_ops_alerts_enabled',    'bool', 'Ops Alerts Enabled',      'Send operational alerts (anomalies, scan failures, degradation). Off by default.', False),

    # ── Paper Trading ─────────────────────────────────────────────────────────
    SettingDef('paper_trading', 'paper_trading_enabled',          'bool',  'Paper Trading Enabled',   'Enable the virtual paper trading portfolio',            True),
    SettingDef('paper_trading', 'paper_trading_initial_balance',  'float', 'Initial Balance (USD)',   'Starting virtual balance for the paper portfolio',      10000.0, 100.0, 1000000.0),
    SettingDef('paper_trading', 'paper_trading_max_open_trades',  'int',   'Max Open Trades',         'Maximum simultaneous open paper positions',             5,       1,     50),
    SettingDef('paper_trading', 'paper_trading_position_size_pct','float', 'Position Size %',         'Fraction of balance allocated per trade (0.10 = 10%)',  0.10,    0.01,  1.0),

    # ── Readiness ─────────────────────────────────────────────────────────────
    SettingDef('readiness', 'min_signals_for_edge',            'int',   'Min Signals for Edge',          'Resolved signals needed before declaring edge measurable',     30,  5,   500),
    SettingDef('readiness', 'min_signals_for_report',          'int',   'Min Signals for Full Report',   'Resolved signals needed for a complete readiness report',     100, 20,  1000),
    SettingDef('readiness', 'weight_operational_stability',    'float', 'Weight: Ops Stability',         'Score weight for operational stability component (sum must ≈1)', 0.25, 0.0, 1.0),
    SettingDef('readiness', 'weight_signal_edge',              'float', 'Weight: Signal Edge',           'Score weight for signal edge component',                      0.30, 0.0, 1.0),
    SettingDef('readiness', 'weight_calibration',              'float', 'Weight: Calibration',           'Score weight for probability calibration component',          0.20, 0.0, 1.0),
    SettingDef('readiness', 'weight_ai_effectiveness',         'float', 'Weight: AI Effectiveness',      'Score weight for AI validation effectiveness component',      0.15, 0.0, 1.0),
    SettingDef('readiness', 'weight_data_coverage',            'float', 'Weight: Data Coverage',         'Score weight for data coverage component',                    0.10, 0.0, 1.0),

    # ── Anomaly Thresholds ────────────────────────────────────────────────────
    # Mirror backend/analytics/anomaly_detector.py constants
    SettingDef('anomaly', 'win_rate_drop_warn',    'float', 'Win Rate Drop — Warning',   'Win rate drop (pp) triggering a warning anomaly',          0.12, 0.0, 1.0),
    SettingDef('anomaly', 'win_rate_drop_crit',    'float', 'Win Rate Drop — Critical',  'Win rate drop (pp) triggering a critical anomaly',         0.25, 0.0, 1.0),
    SettingDef('anomaly', 'false_positive_warn',   'float', 'False Positive — Warning',  'SL hit rate above this triggers a warning',                0.70, 0.0, 1.0),
    SettingDef('anomaly', 'expectancy_crit',        'float', 'Expectancy — Critical',    'Negative rolling expectancy at or below this is critical', 0.0, -10.0, 10.0),
    SettingDef('anomaly', 'drawdown_warn',          'float', 'Drawdown — Warning (R)',   'Max drawdown in R that triggers a warning',                5.0,  0.0, 100.0),
    SettingDef('anomaly', 'drawdown_crit',          'float', 'Drawdown — Critical (R)',  'Max drawdown in R that triggers a critical anomaly',      10.0,  0.0, 100.0),
    SettingDef('anomaly', 'ece_warn',               'float', 'ECE — Warning',            'Expected Calibration Error warning threshold',             0.12, 0.0,   1.0),
    SettingDef('anomaly', 'ece_crit',               'float', 'ECE — Critical',           'Expected Calibration Error critical threshold',            0.20, 0.0,   1.0),
    SettingDef('anomaly', 'ece_drift_threshold',    'float', 'ECE Drift Threshold',      'ECE increase vs previous snapshot that signals drift',    0.05, 0.0,   1.0),
    SettingDef('anomaly', 'scan_failure_warn',      'float', 'Scan Failure — Warning',   'Scan error rate triggering a warning',                     0.15, 0.0,   1.0),
    SettingDef('anomaly', 'scan_failure_crit',      'float', 'Scan Failure — Critical',  'Scan error rate triggering a critical anomaly',            0.30, 0.0,   1.0),
    SettingDef('anomaly', 'ai_error_warn',          'float', 'AI Error — Warning',       'Claude API error rate triggering a warning',               0.08, 0.0,   1.0),
    SettingDef('anomaly', 'ai_error_crit',          'float', 'AI Error — Critical',      'Claude API error rate triggering a critical anomaly',      0.15, 0.0,   1.0),
    SettingDef('anomaly', 'ai_fallback_warn',       'float', 'AI Fallback — Warning',    'Fallback rate above this suggests Claude often failing',   0.40, 0.0,   1.0),
    SettingDef('anomaly', 'queue_depth_warn',       'int',   'Queue Depth — Warning',    'Celery queue depth triggering a warning',                  10,   0,    1000),
    SettingDef('anomaly', 'queue_depth_crit',       'int',   'Queue Depth — Critical',   'Celery queue depth triggering a critical anomaly',         30,   0,    1000),

    # ── Feature Flags ─────────────────────────────────────────────────────────
    SettingDef('features', 'futures_intelligence_enabled', 'bool', 'Futures Intelligence',      'Run funding/OI/L:S analysis on futures/high_confidence scans',  True),
    SettingDef('features', 'anomaly_detection_enabled',    'bool', 'Anomaly Detection',         'Run hourly anomaly checks and store results',                    True),
    SettingDef('features', 'paper_trading_monitor_enabled','bool', 'Paper Trading Monitor',     'Run the per-minute paper trade position monitor task',           True),
    SettingDef('features', 'backtest_enabled',             'bool', 'Backtesting',               'Allow backtest runs via the API',                               True),
    SettingDef('features', 'telegram_enabled',             'bool', 'Telegram Integration',      'Master switch — disables all Telegram output when off',         True),
    SettingDef('features', 'daily_analytics_snapshot',     'bool', 'Daily Analytics Snapshot',  'Compute and persist the nightly full edge report snapshot',      True),
]

# ── Lookup indexes ────────────────────────────────────────────────────────────

DEFINITIONS_BY_KEY: dict[str, SettingDef] = {d.key: d for d in ALL_DEFINITIONS}

DEFINITIONS_BY_CATEGORY: dict[str, list[SettingDef]] = {}
for _d in ALL_DEFINITIONS:
    DEFINITIONS_BY_CATEGORY.setdefault(_d.category, []).append(_d)

CATEGORIES: list[str] = list(DEFINITIONS_BY_CATEGORY.keys())
