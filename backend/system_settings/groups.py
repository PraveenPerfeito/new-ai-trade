"""
Strongly-typed settings groups — one Pydantic model per operational domain.

Each model defines:
  - Field-level constraints  (ge/le/allowed_values via Field metadata)
  - Cross-field validators   (model_validator — ordering, sum, consistency)
  - Schema versioning        (SCHEMA_VERSION ClassVar — bump on breaking changes)
  - Defaults                 (Field(default=...) — mirrors existing hard-coded constants)
  - Restart flag             (json_schema_extra={"restart": True})

The GROUP_REGISTRY maps group_name → model class for service lookups.

Do NOT use `from __future__ import annotations` in this module — the
_extract_field_meta() helper reads fi.annotation at class-definition time
and needs the actual type objects, not deferred strings.
"""

from dataclasses import dataclass
from typing import Any, ClassVar, Literal, get_args, get_origin

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.fields import FieldInfo


# ── Field metadata helper ─────────────────────────────────────────────────────

@dataclass
class FieldMeta:
    key:              str
    data_type:        str          # 'bool' | 'int' | 'float' | 'string' | 'enum'
    label:            str
    description:      str
    default:          Any
    min_val:          float | None
    max_val:          float | None
    allowed_values:   list[str] | None
    requires_restart: bool


def _extract_field_meta(name: str, fi: FieldInfo) -> FieldMeta:
    ann = fi.annotation

    # Determine data type from annotation
    origin = get_origin(ann)
    if origin is Literal:
        data_type = 'enum'
        allowed_values: list[str] | None = [str(v) for v in get_args(ann)]
    elif ann is bool:
        data_type = 'bool'
        allowed_values = None
    elif ann is int:
        data_type = 'int'
        allowed_values = None
    elif ann is float:
        data_type = 'float'
        allowed_values = None
    else:
        data_type = 'string'
        allowed_values = None

    # Extract min/max from Pydantic v2 metadata constraints
    min_val: float | None = None
    max_val: float | None = None
    for constraint in (fi.metadata or []):
        if hasattr(constraint, 'ge'):
            min_val = float(constraint.ge)
        if hasattr(constraint, 'gt'):
            min_val = float(constraint.gt)
        if hasattr(constraint, 'le'):
            max_val = float(constraint.le)
        if hasattr(constraint, 'lt'):
            max_val = float(constraint.lt)

    extra = fi.json_schema_extra or {}

    # Resolve default — fi.default is PydanticUndefined for default_factory fields
    try:
        from pydantic_core import PydanticUndefined  # noqa: PLC0415
        raw_default = fi.default
        if raw_default is PydanticUndefined:
            raw_default = fi.default_factory() if callable(fi.default_factory) else None
    except Exception:
        raw_default = None

    return FieldMeta(
        key=name,
        data_type=data_type,
        label=fi.title or name.replace('_', ' ').title(),
        description=fi.description or '',
        default=raw_default,
        min_val=min_val,
        max_val=max_val,
        allowed_values=allowed_values,
        requires_restart=bool(extra.get('restart', False)),
    )


# ── Base class ────────────────────────────────────────────────────────────────

class BaseSettingsGroup(BaseModel):
    model_config = ConfigDict(extra='ignore', populate_by_name=True)

    GROUP_NAME:     ClassVar[str]
    SCHEMA_VERSION: ClassVar[int] = 1

    @classmethod
    def fields_meta(cls) -> list[FieldMeta]:
        return [_extract_field_meta(n, fi) for n, fi in cls.model_fields.items()]

    @classmethod
    def defaults_dict(cls) -> dict[str, Any]:
        return cls().model_dump()


# ── 1. Scanner ────────────────────────────────────────────────────────────────

class ScannerSettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'scanner'
    SCHEMA_VERSION: ClassVar[int] = 1

    delay_ms: int = Field(
        300, ge=0, le=5_000,
        title='Scan Delay (ms)',
        description='Pause between individual coin scans to respect rate limits',
    )
    min_confidence: int = Field(
        75, ge=50, le=100,
        title='Minimum Confidence',
        description='Signals below this score are discarded before storage',
    )
    alert_confidence: int = Field(
        85, ge=50, le=100,
        title='Alert Confidence',
        description='Minimum confidence to trigger Telegram alerts and paper trades',
    )
    max_coins_per_run: int = Field(
        100, ge=10, le=200,
        title='Max Coins Per Run',
        description='Cap on coins scanned per scheduler cycle',
    )
    volume_spike_threshold: float = Field(
        2.0, ge=1.0, le=10.0,
        title='Volume Spike Threshold',
        description='Minimum volume ratio vs 20-candle average to pass the volume gate',
    )
    rsi_oversold: int = Field(
        35, ge=10, le=50,
        title='RSI Oversold Level',
        description='RSI below this qualifies a candle as oversold',
    )
    rsi_overbought: int = Field(
        65, ge=50, le=90,
        title='RSI Overbought Level',
        description='RSI above this qualifies a candle as overbought',
    )
    trending_watchlist: list[str] = Field(
        default_factory=list,
        title='Trending Watchlist',
        description=(
            'Symbols to prioritise in TRENDING scan mode (founder watchlist). '
            'Max 50 entries, each up to 10 characters. '
            'Example: ["NEAR", "FIL", "AVAX"]'
        ),
        max_length=50,
    )

    @model_validator(mode='after')
    def alert_gte_min(self) -> 'ScannerSettings':
        if self.alert_confidence < self.min_confidence:
            raise ValueError(
                f'alert_confidence ({self.alert_confidence}) must be ≥ '
                f'min_confidence ({self.min_confidence})'
            )
        return self

    @model_validator(mode='after')
    def rsi_order(self) -> 'ScannerSettings':
        if self.rsi_overbought <= self.rsi_oversold:
            raise ValueError(
                f'rsi_overbought ({self.rsi_overbought}) must be > '
                f'rsi_oversold ({self.rsi_oversold})'
            )
        return self


# ── 2. Signal Thresholds ──────────────────────────────────────────────────────

class SignalThresholdSettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'signals'
    SCHEMA_VERSION: ClassVar[int] = 1

    min_rr_ratio: float = Field(
        1.5, ge=0.5, le=10.0,
        title='Min Risk/Reward Ratio',
        description='Signals with RR below this are rejected by the quality gate',
    )
    max_sl_pct: float = Field(
        0.08, ge=0.01, le=0.20,
        title='Max Stop-Loss %',
        description='Maximum stop-loss distance as a fraction of entry price',
    )
    min_quality_score: int = Field(
        40, ge=0, le=100,
        title='Min Quality Score',
        description='Minimum composite quality score from the risk engine',
    )
    confidence_high: int = Field(
        85, ge=60, le=100,
        title='High Confidence Threshold',
        description='Confidence score at or above this is labelled HIGH',
    )
    confidence_medium: int = Field(
        75, ge=50, le=100,
        title='Medium Confidence Threshold',
        description='Confidence score at or above this is labelled MEDIUM',
    )
    min_atr_multiplier: float = Field(
        1.0, ge=0.1, le=5.0,
        title='Min ATR Multiplier',
        description='Stop-loss must be at least this many ATRs from entry',
    )

    @model_validator(mode='after')
    def confidence_order(self) -> 'SignalThresholdSettings':
        if self.confidence_high <= self.confidence_medium:
            raise ValueError(
                f'confidence_high ({self.confidence_high}) must be > '
                f'confidence_medium ({self.confidence_medium})'
            )
        return self


# ── 3. AI ─────────────────────────────────────────────────────────────────────

class AISettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'ai'
    SCHEMA_VERSION: ClassVar[int] = 1

    enabled: bool = Field(
        True,
        title='AI Validation Enabled',
        description='Enable Claude Haiku validation as the final pipeline step',
    )
    model: Literal[
        'claude-haiku-4-5',
        'claude-haiku-4-5-20251001',
        'claude-sonnet-4-6',
        'claude-opus-4-7',
    ] = Field(
        'claude-haiku-4-5',
        title='Claude Model',
        description='Anthropic model used for signal validation',
        json_schema_extra={'restart': True},
    )
    max_tokens: int = Field(
        500, ge=50, le=4_096,
        title='Max Response Tokens',
        description='Token budget for each Claude validation response',
    )
    temperature: float = Field(
        0.3, ge=0.0, le=1.0,
        title='Temperature',
        description='Sampling temperature — lower values are more deterministic',
    )
    timeout_secs: int = Field(
        20, ge=5, le=120,
        title='Request Timeout (s)',
        description='Seconds before the Claude API call times out',
    )
    fallback_on_error: bool = Field(
        True,
        title='Fallback on Error',
        description='Use heuristic fallback when the Claude API is unavailable',
    )
    max_retries: int = Field(
        2, ge=0, le=5,
        title='Max Retries',
        description='Number of retry attempts on transient API errors',
    )
    daily_call_limit: int = Field(
        50, ge=0, le=10_000,
        title='Daily Call Limit',
        description='Max Claude API calls per day (0 = unlimited). Default 50 ≈ $0.03/day. When exceeded, falls back to heuristic — scanner never stops.',
    )


# ── 4. Telegram ───────────────────────────────────────────────────────────────

class TelegramSettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'telegram'
    SCHEMA_VERSION: ClassVar[int] = 1

    alerts_enabled: bool = Field(
        True,
        title='Signal Alerts Enabled',
        description='Send signal alert messages via Telegram',
    )
    min_confidence: int = Field(
        85, ge=50, le=100,
        title='Min Alert Confidence',
        description='Only send alerts for signals at or above this confidence',
    )
    max_alerts_per_hour: int = Field(
        10, ge=1, le=100,
        title='Max Alerts / Hour',
        description='Rate cap on outgoing Telegram signal alerts',
    )
    daily_summary_enabled: bool = Field(
        True,
        title='Daily Summary Enabled',
        description='Send a nightly performance summary message',
    )
    daily_summary_hour_utc: int = Field(
        8, ge=0, le=23,
        title='Summary Hour (UTC)',
        description='Hour of day (UTC) to send the daily summary',
    )
    include_ai_analysis: bool = Field(
        True,
        title='Include AI Analysis',
        description='Include Claude validation reasoning in alert messages',
    )


# ── 5. Risk ───────────────────────────────────────────────────────────────────

class RiskSettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'risk'
    SCHEMA_VERSION: ClassVar[int] = 1

    reject_f_grade: bool = Field(
        True,
        title='Reject F-Grade Signals',
        description='Automatically discard grade-F signals without spending AI tokens',
    )
    min_quality_score: int = Field(
        40, ge=0, le=100,
        title='Min Quality Score',
        description='Signals below this composite quality score are rejected',
    )
    max_leverage_conservative: int = Field(
        3, ge=1, le=10,
        title='Max Leverage — Conservative',
        description='Maximum recommended leverage for conservative setups',
    )
    max_leverage_standard: int = Field(
        5, ge=1, le=25,
        title='Max Leverage — Standard',
        description='Maximum recommended leverage for standard setups',
    )
    max_leverage_aggressive: int = Field(
        10, ge=1, le=50,
        title='Max Leverage — Aggressive',
        description='Maximum recommended leverage for aggressive futures setups',
    )
    max_portfolio_risk_pct: float = Field(
        0.02, ge=0.001, le=0.10,
        title='Max Portfolio Risk Per Trade',
        description='Maximum capital at risk per trade as a fraction of portfolio',
    )

    @model_validator(mode='after')
    def leverage_order(self) -> 'RiskSettings':
        if not (self.max_leverage_conservative
                <= self.max_leverage_standard
                <= self.max_leverage_aggressive):
            raise ValueError(
                'Leverage limits must satisfy: conservative ≤ standard ≤ aggressive'
            )
        return self


# ── 6. Paper Trading ──────────────────────────────────────────────────────────

class PaperTradingSettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'paper_trading'
    SCHEMA_VERSION: ClassVar[int] = 1

    enabled: bool = Field(
        True,
        title='Paper Trading Enabled',
        description='Enable the virtual paper-trading portfolio',
    )
    initial_balance: float = Field(
        10_000.0, ge=100.0, le=1_000_000.0,
        title='Initial Balance (USD)',
        description='Starting virtual balance for a fresh portfolio',
    )
    max_open_trades: int = Field(
        5, ge=1, le=50,
        title='Max Open Trades',
        description='Maximum simultaneous open paper positions',
    )
    position_size_pct: float = Field(
        0.10, ge=0.01, le=1.0,
        title='Position Size %',
        description='Fraction of balance allocated per trade (0.10 = 10%)',
    )
    slippage_pct: float = Field(
        0.001, ge=0.0, le=0.05,
        title='Simulated Slippage %',
        description='Price slippage applied to simulated entries/exits',
    )
    commission_pct: float = Field(
        0.001, ge=0.0, le=0.05,
        title='Commission %',
        description='Per-trade commission deducted from paper P&L',
    )


# ── 7. Anomaly Detection ──────────────────────────────────────────────────────

class AnomalySettings(BaseSettingsGroup):
    """
    Mirrors the threshold constants in backend/analytics/anomaly_detector.py.
    These settings are the DB-backed runtime overrides; the module still uses
    its own constants until wired to read from this service.
    """
    GROUP_NAME:     ClassVar[str] = 'anomaly'
    SCHEMA_VERSION: ClassVar[int] = 1

    # Signal quality
    win_rate_drop_warn:  float = Field(0.12, ge=0.0, le=1.0, title='Win Rate Drop — Warning',  description='Win rate drop (pp) triggering a warning anomaly')
    win_rate_drop_crit:  float = Field(0.25, ge=0.0, le=1.0, title='Win Rate Drop — Critical', description='Win rate drop (pp) triggering a critical anomaly')
    false_positive_warn: float = Field(0.70, ge=0.0, le=1.0, title='False Positive — Warning', description='SL hit rate above this triggers a warning')
    expectancy_crit:     float = Field(0.0, ge=-10.0, le=10.0, title='Expectancy — Critical',  description='Rolling expectancy at or below this is critical (n≥20)')
    drawdown_warn:       float = Field(5.0,  ge=0.0, le=100.0, title='Drawdown — Warning (R)', description='Max drawdown in R triggering a warning')
    drawdown_crit:       float = Field(10.0, ge=0.0, le=100.0, title='Drawdown — Critical (R)', description='Max drawdown in R triggering a critical anomaly')
    ece_warn:            float = Field(0.12, ge=0.0, le=1.0, title='ECE — Warning',            description='Expected Calibration Error warning threshold')
    ece_crit:            float = Field(0.20, ge=0.0, le=1.0, title='ECE — Critical',           description='Expected Calibration Error critical threshold')
    ece_drift_threshold: float = Field(0.05, ge=0.0, le=1.0, title='ECE Drift Threshold',      description='ECE increase vs previous snapshot that signals drift')

    # Operational
    scan_failure_warn:   float = Field(0.15, ge=0.0, le=1.0, title='Scan Failure — Warning',  description='Scan error rate triggering a warning')
    scan_failure_crit:   float = Field(0.30, ge=0.0, le=1.0, title='Scan Failure — Critical', description='Scan error rate triggering a critical anomaly')
    ai_error_warn:       float = Field(0.08, ge=0.0, le=1.0, title='AI Error — Warning',      description='Claude API error rate triggering a warning')
    ai_error_crit:       float = Field(0.15, ge=0.0, le=1.0, title='AI Error — Critical',     description='Claude API error rate triggering a critical anomaly')
    ai_fallback_warn:    float = Field(0.40, ge=0.0, le=1.0, title='AI Fallback — Warning',   description='Fallback rate above this suggests Claude often failing')
    queue_depth_warn:    int   = Field(10, ge=0, le=1_000, title='Queue Depth — Warning',     description='Celery queue depth triggering a warning')
    queue_depth_crit:    int   = Field(30, ge=0, le=1_000, title='Queue Depth — Critical',    description='Celery queue depth triggering a critical anomaly')

    @model_validator(mode='after')
    def threshold_pairs_ordered(self) -> 'AnomalySettings':
        pairs = [
            ('win_rate_drop_warn', 'win_rate_drop_crit'),
            ('drawdown_warn',      'drawdown_crit'),
            ('ece_warn',           'ece_crit'),
            ('scan_failure_warn',  'scan_failure_crit'),
            ('ai_error_warn',      'ai_error_crit'),
            ('queue_depth_warn',   'queue_depth_crit'),
        ]
        for warn_f, crit_f in pairs:
            w, c = getattr(self, warn_f), getattr(self, crit_f)
            if w >= c:
                raise ValueError(
                    f'{warn_f} ({w}) must be strictly less than {crit_f} ({c})'
                )
        return self


# ── 8. Feature Flags ──────────────────────────────────────────────────────────

class FeatureFlags(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'features'
    SCHEMA_VERSION: ClassVar[int] = 1

    futures_intelligence:    bool = Field(True,  title='Futures Intelligence',     description='Run funding/OI/L:S analysis on futures and high_confidence scans')
    anomaly_detection:       bool = Field(True,  title='Anomaly Detection',        description='Run hourly anomaly checks and persist results')
    paper_trading_monitor:   bool = Field(True,  title='Paper Trading Monitor',    description='Run the per-minute position monitor Celery task')
    backtest:                bool = Field(True,  title='Backtesting',              description='Allow backtest runs via the API')
    telegram:                bool = Field(True,  title='Telegram',                 description='Master switch — all Telegram output disabled when off')
    daily_analytics_snapshot:bool = Field(True,  title='Daily Analytics Snapshot', description='Compute and persist the nightly edge report snapshot')
    ai_validation:           bool = Field(True,  title='AI Validation',            description='Enable the Claude validation step (also controlled by AISettings.enabled)')
    rate_limiting:           bool = Field(True,  title='Rate Limiting',            description='Apply API rate limits via slowapi middleware')
    # ── Operational overrides (highest precedence) ────────────────────────────
    emergency_stop:          bool = Field(False, title='Emergency Stop',           description='Immediately halt all scans, signal generation, and Telegram output. Overrides every other switch.')
    maintenance_mode:        bool = Field(False, title='Maintenance Mode',         description='Allow read-only API calls; block all writes, scans, and Telegram sends.')


# ── 9. Infrastructure ─────────────────────────────────────────────────────────

class InfrastructureSettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'infra'
    SCHEMA_VERSION: ClassVar[int] = 1

    # ── Application ───────────────────────────────────────────────────────────
    log_level: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR'] = Field(
        'INFO',
        title='Log Level',
        description='Application-wide log verbosity',
        json_schema_extra={'restart': True},
    )

    # ── Database ──────────────────────────────────────────────────────────────
    db_pool_min_size: int = Field(
        2, ge=1, le=20,
        title='DB Pool Min Size',
        description='Minimum asyncpg connection pool size',
        json_schema_extra={'restart': True},
    )
    db_pool_max_size: int = Field(
        10, ge=2, le=50,
        title='DB Pool Max Size',
        description='Maximum asyncpg connection pool size',
        json_schema_extra={'restart': True},
    )

    # ── Redis / Cache ─────────────────────────────────────────────────────────
    redis_mem_cache_ttl_secs: int = Field(
        30, ge=5, le=600,
        title='In-Memory Cache TTL (s)',
        description='How long per-process caches hold data before refreshing from Redis/DB',
    )
    redis_group_cache_ttl_secs: int = Field(
        3_600, ge=60, le=86_400,
        title='Redis Settings Cache TTL (s)',
        description='How long settings groups are cached in Redis before DB re-load',
    )

    # ── API / Rate Limits ─────────────────────────────────────────────────────
    rate_limit_per_minute: int = Field(
        60, ge=1, le=10_000,
        title='Rate Limit (reqs/min)',
        description='Per-IP API rate limit (requires restart if rate_limiting feature is toggled)',
    )
    max_scan_concurrency: int = Field(
        5, ge=1, le=20,
        title='Max Scan Concurrency',
        description='Maximum number of coins scanned concurrently per run',
    )
    scanner_timeout_secs: int = Field(
        60, ge=10, le=300,
        title='Scanner Timeout (s)',
        description='Hard timeout per Celery scan task',
    )

    # ── Readiness Scoring ─────────────────────────────────────────────────────
    burnin_min_signals_for_edge: int = Field(
        30, ge=5, le=500,
        title='Burn-In: Min Signals for Edge',
        description='Resolved signals needed before declaring an edge measurable',
    )
    burnin_min_signals_for_report: int = Field(
        100, ge=20, le=2_000,
        title='Burn-In: Min Signals for Full Report',
        description='Resolved signals needed for a complete production readiness report',
    )
    readiness_weight_ops:   float = Field(0.25, ge=0.0, le=1.0, title='Readiness Weight: Ops',         description='Score weight for operational stability')
    readiness_weight_edge:  float = Field(0.30, ge=0.0, le=1.0, title='Readiness Weight: Edge',        description='Score weight for signal edge')
    readiness_weight_cal:   float = Field(0.20, ge=0.0, le=1.0, title='Readiness Weight: Calibration', description='Score weight for probability calibration')
    readiness_weight_ai:    float = Field(0.15, ge=0.0, le=1.0, title='Readiness Weight: AI',          description='Score weight for AI effectiveness')
    readiness_weight_data:  float = Field(0.10, ge=0.0, le=1.0, title='Readiness Weight: Coverage',   description='Score weight for data coverage')

    @model_validator(mode='after')
    def db_pool_order(self) -> 'InfrastructureSettings':
        if self.db_pool_max_size < self.db_pool_min_size:
            raise ValueError(
                f'db_pool_max_size ({self.db_pool_max_size}) must be ≥ '
                f'db_pool_min_size ({self.db_pool_min_size})'
            )
        return self

    @model_validator(mode='after')
    def burnin_order(self) -> 'InfrastructureSettings':
        if self.burnin_min_signals_for_report < self.burnin_min_signals_for_edge:
            raise ValueError(
                f'burnin_min_signals_for_report ({self.burnin_min_signals_for_report}) '
                f'must be ≥ burnin_min_signals_for_edge ({self.burnin_min_signals_for_edge})'
            )
        return self

    @model_validator(mode='after')
    def readiness_weights_sum(self) -> 'InfrastructureSettings':
        total = (
            self.readiness_weight_ops
            + self.readiness_weight_edge
            + self.readiness_weight_cal
            + self.readiness_weight_ai
            + self.readiness_weight_data
        )
        if abs(total - 1.0) > 0.01:
            raise ValueError(
                f'Readiness weights must sum to 1.0 (currently {total:.3f}). '
                'Adjust one or more weights to compensate.'
            )
        return self


# ── 10. Market Data Providers ─────────────────────────────────────────────────

class ProviderSettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'providers'
    SCHEMA_VERSION: ClassVar[int] = 1

    active_provider: Literal[
        'coinmarketcap', 'coingecko', 'binance', 'dexscreener', 'coinpaprika', 'geckoterm'
    ] = Field(
        'coinmarketcap',
        title='Active Provider',
        description='Primary market data provider — others are failover only',
    )
    coinmarketcap_enabled: bool = Field(True, title='CoinMarketCap Enabled',  description='Allow CoinMarketCap as a provider (requires API key)')
    coingecko_enabled:     bool = Field(True, title='CoinGecko Enabled',      description='Allow CoinGecko as a fallback provider')
    binance_enabled:       bool = Field(True, title='Binance Enabled',        description='Allow Binance ticker as a fallback provider')
    dexscreener_enabled:   bool = Field(True, title='DexScreener Enabled',    description='Allow DexScreener as a fallback provider')
    coinpaprika_enabled:   bool = Field(True, title='CoinPaprika Enabled',    description='Allow CoinPaprika as a fallback provider')
    geckoterm_enabled:     bool = Field(True, title='GeckoTerminal Enabled',  description='Allow GeckoTerminal as a fallback provider')

    # Priority order (1 = highest): controls failover sequence
    coinmarketcap_priority: int = Field(1, ge=1, le=6, title='CoinMarketCap Priority')
    coingecko_priority:     int = Field(2, ge=1, le=6, title='CoinGecko Priority')
    binance_priority:       int = Field(3, ge=1, le=6, title='Binance Priority')
    dexscreener_priority:   int = Field(4, ge=1, le=6, title='DexScreener Priority')
    coinpaprika_priority:   int = Field(5, ge=1, le=6, title='CoinPaprika Priority')
    geckoterm_priority:     int = Field(6, ge=1, le=6, title='GeckoTerminal Priority')


# ── 11. Failover ──────────────────────────────────────────────────────────────

class FailoverSettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'failover'
    SCHEMA_VERSION: ClassVar[int] = 1

    auto_failover_enabled: bool = Field(
        True,
        title='Auto-Failover Enabled',
        description='Automatically switch to the next healthy provider on failure',
    )
    health_score_threshold: int = Field(
        40, ge=0, le=100,
        title='Health Score Threshold',
        description='Providers with health score below this are skipped during failover',
    )
    max_consecutive_errors: int = Field(
        3, ge=1, le=20,
        title='Max Consecutive Errors',
        description='Disable a provider temporarily after this many consecutive failures',
    )
    cooldown_secs: int = Field(
        300, ge=30, le=3_600,
        title='Failover Cooldown (s)',
        description='Seconds a provider is suspended after reaching max_consecutive_errors',
    )
    quota_alert_pct: int = Field(
        80, ge=50, le=99,
        title='Quota Alert Threshold (%)',
        description='Send Telegram alert when a provider quota reaches this percentage',
    )
    latency_alert_ms: int = Field(
        5_000, ge=500, le=60_000,
        title='Latency Alert Threshold (ms)',
        description='Send Telegram alert when p95 latency exceeds this value',
    )


# ── 12. Quota ─────────────────────────────────────────────────────────────────

class QuotaSettings(BaseSettingsGroup):
    """Daily quota limits for paid providers (0 = unlimited)."""
    GROUP_NAME:     ClassVar[str] = 'quota'
    SCHEMA_VERSION: ClassVar[int] = 1

    coingecko_daily_limit:     int = Field(0,      ge=0, le=10_000_000, title='CoinGecko Daily Limit',     description='0 = unlimited (free/pro tier)')
    coinmarketcap_daily_limit: int = Field(10_000, ge=0, le=10_000_000, title='CoinMarketCap Daily Limit', description='CMC Basic free tier = 10,000 credits/month (~333/day)')
    binance_daily_limit:       int = Field(0,      ge=0, le=10_000_000, title='Binance Daily Limit',       description='0 = effectively unlimited for REST polling')
    dexscreener_daily_limit:   int = Field(0,      ge=0, le=10_000_000, title='DexScreener Daily Limit',   description='0 = unlimited (free API)')
    coinpaprika_daily_limit:   int = Field(0,      ge=0, le=10_000_000, title='CoinPaprika Daily Limit',   description='0 = unlimited (free API)')
    geckoterm_daily_limit:     int = Field(0,      ge=0, le=10_000_000, title='GeckoTerminal Daily Limit', description='0 = unlimited (free API)')


# ── 13. Market Cache ──────────────────────────────────────────────────────────

class MarketCacheSettings(BaseSettingsGroup):
    GROUP_NAME:     ClassVar[str] = 'market_cache'
    SCHEMA_VERSION: ClassVar[int] = 1

    coins_ttl_secs: int = Field(
        300, ge=30, le=1_800,
        title='Coins Cache TTL (s)',
        description='How long top-coins results are cached before a fresh provider fetch',
    )
    provider_metrics_latency_window: int = Field(
        100, ge=10, le=1_000,
        title='Latency Ring-Buffer Size',
        description='Number of latency samples kept per provider for p95 calculation',
    )
    provider_metrics_error_window: int = Field(
        100, ge=10, le=1_000,
        title='Error Ring-Buffer Size',
        description='Number of error timestamps kept per provider for error-rate calculation',
    )
    failover_log_max: int = Field(
        50, ge=10, le=500,
        title='Failover Log Size',
        description='Maximum failover events retained in Redis history',
    )


# ── Registry ──────────────────────────────────────────────────────────────────

GROUP_REGISTRY: dict[str, type[BaseSettingsGroup]] = {
    cls.GROUP_NAME: cls
    for cls in [
        ScannerSettings,
        SignalThresholdSettings,
        AISettings,
        TelegramSettings,
        RiskSettings,
        PaperTradingSettings,
        AnomalySettings,
        FeatureFlags,
        InfrastructureSettings,
        ProviderSettings,
        FailoverSettings,
        QuotaSettings,
        MarketCacheSettings,
    ]
}

ALL_GROUPS: list[type[BaseSettingsGroup]] = list(GROUP_REGISTRY.values())
