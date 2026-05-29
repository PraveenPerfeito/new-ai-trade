"""
Pydantic models for the scanner core engine.
Mirror of types/index.ts — kept in sync so the API layer can serialise
either side without conversion.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ── Enumerations ──────────────────────────────────────────────────────────────

class TrendDirection(str, Enum):
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"
    RANGING = "RANGING"


class VolatilityRating(str, Enum):
    LOW     = "LOW"
    NORMAL  = "NORMAL"
    HIGH    = "HIGH"
    EXTREME = "EXTREME"


class MTFAlignment(str, Enum):
    STRONG     = "STRONG"
    WEAK       = "WEAK"
    CONFLICTED = "CONFLICTED"


class SignalType(str, Enum):
    BUY  = "BUY"
    SELL = "SELL"


class ScannerMode(str, Enum):
    SPOT            = "spot"
    FUTURES         = "futures"
    HIGH_CONFIDENCE = "high_confidence"
    TRENDING        = "trending"


class RiskGrade(str, Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    F = "F"


class ViolationSeverity(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH     = "HIGH"
    MEDIUM   = "MEDIUM"
    LOW      = "LOW"


# ── OHLCV candle ─────────────────────────────────────────────────────────────

class Candle(BaseModel):
    open_time:  int
    open:       float
    high:       float
    low:        float
    close:      float
    volume:     float
    close_time: int = 0


# ── Indicator models ──────────────────────────────────────────────────────────

class MACDResult(BaseModel):
    macd:      float
    signal:    float
    histogram: float


class BollingerBands(BaseModel):
    upper:   float
    middle:  float
    lower:   float
    width:   float  # (upper - lower) / middle — normalized band width
    squeeze: bool   # True when width < 80% of 20-period average width


class TechnicalIndicators(BaseModel):
    rsi:            float
    macd:           MACDResult
    ema20:          float
    ema50:          float
    ema200:         float = 0.0   # 200-period EMA (0.0 when insufficient history)
    bb:             BollingerBands | None = None  # Bollinger Bands
    atr:            float
    volume_spike:   float
    current_price:  float
    trend:          TrendDirection
    candle_pattern: str = ""  # detected pattern: HAMMER, SHOOTING_STAR, MORNING_STAR, etc.
    ema_cross:      str = ""  # GOLDEN_CROSS | DEATH_CROSS | "" (fresh cross within last 5 candles)


class MultiTimeframeResult(BaseModel):
    confirmed: bool
    reason:    str
    alignment: MTFAlignment


# ── Risk models ───────────────────────────────────────────────────────────────

class RiskViolation(BaseModel):
    code:     str
    message:  str
    severity: ViolationSeverity


class RiskWarning(BaseModel):
    code:    str
    message: str


class CoinData(BaseModel):
    """Coin fields used by the risk engine and scanner orchestrator."""
    id:               str
    symbol:           str
    name:             str
    price:            float
    market_cap:       float
    volume_24h:       float
    price_change_24h: float
    rank:             int
    image:            str = ""
    binance_symbol:   str = ""
    has_futures:      bool = False


class RiskInput(BaseModel):
    entry:             float
    stop_loss:         float
    rr_ratio:          float
    ind_1h:            TechnicalIndicators
    ind_4h:            TechnicalIndicators
    coin:              CoinData
    signal_type:       SignalType
    mode:              ScannerMode
    volatility:        VolatilityRating
    combined_strength: float


class RiskResult(BaseModel):
    pass_:                   bool = Field(alias="pass")
    risk_score:              float
    quality_score:           float
    risk_grade:              RiskGrade
    violations:              list[RiskViolation]
    warnings:                list[RiskWarning]
    max_safe_leverage:       int
    position_size_multiplier: float
    summary:                 str

    model_config = {"populate_by_name": True}


# ── Market structure models ───────────────────────────────────────────────────

class MarketStructureResult(BaseModel):
    pass_:            bool = Field(alias="pass")
    rejection_reason: str | None
    adx:              float

    model_config = {"populate_by_name": True}


# ── Scanner configuration ─────────────────────────────────────────────────────

class ScannerConfig(BaseModel):
    min_market_cap:    float
    min_volume_24h:    float
    min_rr_ratio:      float
    min_confidence:    int
    max_coins_to_scan: int
    scanner_mode:      ScannerMode


# ── Futures intelligence models ───────────────────────────────────────────────

class LiquidationZone(BaseModel):
    price:        float
    side:         Literal["LONG_LIQ", "SHORT_LIQ"]
    strength:     Literal["STRONG", "MODERATE", "WEAK"]
    distance_pct: float


class BreakoutSignal(BaseModel):
    detected:         bool
    direction:        Literal["UP", "DOWN"]
    breakout_pct:     float
    range_high:       float
    range_low:        float
    volume_confirmed: bool
    age_candles:      int


class TrendContinuationData(BaseModel):
    is_pullback:              bool
    pullback_depth:           float
    holding_key_level:        bool
    key_level:                float
    continuation_confidence:  int


class FundingBias(str, Enum):
    LONG_HEAVY  = "LONG_HEAVY"
    SHORT_HEAVY = "SHORT_HEAVY"
    NEUTRAL     = "NEUTRAL"


class OITrend(str, Enum):
    RISING  = "RISING"
    FALLING = "FALLING"
    STABLE  = "STABLE"


class FundingTrend(str, Enum):
    """Phase 7.4A.4 — direction of funding rate across the last 3 readings."""
    RISING  = "RISING"   # adverse rate increasing — crowding accelerating
    FALLING = "FALLING"  # adverse rate decreasing — crowding unwinding
    STABLE  = "STABLE"   # no meaningful change between readings


class OIInterpretation(str, Enum):
    """Phase 7.4A.2 — institutional OI interpretation."""
    NEW_LONGS        = "NEW_LONGS"         # price ↑ + OI ↑  (strongest BUY confirmation)
    NEW_SHORTS       = "NEW_SHORTS"        # price ↓ + OI ↑  (strongest SELL confirmation)
    SHORT_COVERING   = "SHORT_COVERING"    # price ↑ + OI ↓  (weak BUY — shorts exiting)
    LONG_LIQUIDATION = "LONG_LIQUIDATION"  # price ↓ + OI ↓  (longs stopped out, squeeze risk)
    NEUTRAL          = "NEUTRAL"           # no clear directional OI signal


class FuturesData(BaseModel):
    funding_rate:            float
    funding_rate_annualized: float
    funding_bias:            FundingBias
    open_interest:           float
    oi_change_24h:           float
    oi_trend:                OITrend
    oi_interpretation:       OIInterpretation = OIInterpretation.NEUTRAL  # Phase 7.4A.2
    funding_trend:           FundingTrend     = FundingTrend.STABLE       # Phase 7.4A.4
    long_short_ratio:        float
    long_account_percent:    float
    short_account_percent:   float
    liquidation_zones:       list[LiquidationZone]
    momentum_score:          int
    breakout:                BreakoutSignal | None = None
    trend_continuation:      TrendContinuationData


# ── Signal pipeline models ────────────────────────────────────────────────────

class TradeLevels(BaseModel):
    entry_price:  float
    target_price: float
    stop_loss:    float
    rr_ratio:     float


class SetupResult(BaseModel):
    has_setup:   bool
    description: str
    pre_score:   int


class AIExplainability(BaseModel):
    trend:      str
    momentum:   str
    volatility: str
    rationale:  str
    summary:    str


class AIValidationResult(BaseModel):
    confidence:     int
    validated:      bool
    reasoning:      str
    risks:          list[str]
    strengths:      list[str]
    explainability: AIExplainability | None = None


class Signal(BaseModel):
    """Full trading signal — output of scan_coin()."""
    symbol:                  str
    name:                    str
    type:                    SignalType
    timeframe:               str = "1h"
    scanner_mode:            ScannerMode
    entry_price:             float
    target_price:            float
    stop_loss:               float
    rr_ratio:                float
    confidence:              int
    indicators:              TechnicalIndicators
    setup_description:       str
    risk_score:              float
    quality_score:           float
    risk_grade:              RiskGrade
    risk_warnings:           list[RiskWarning]
    max_safe_leverage:       int
    position_size_multiplier: float
    futures_data:            FuturesData | None = None
    ai_validated:            bool = False
    ai_reasoning:            str = ""
    ai_explainability:       AIExplainability | None = None
    risks:                   list[str] = []
    strengths:               list[str] = []
    telegram_sent:           bool = False
    scan_run_id:             str | None = None
    id:                      str | None = None


# ── Scan orchestration models ─────────────────────────────────────────────────

class ScanProgress(BaseModel):
    scan_id:      str
    mode:         ScannerMode
    status:       Literal["running", "completed", "failed"]
    total:        int = 0
    scanned:      int = 0
    signals_found: int = 0
    errors:       int = 0
    started_at:   str
    completed_at: str | None = None
    duration_ms:  int | None = None


class ScanResult(BaseModel):
    scan_run_id:   str | None
    mode:          ScannerMode
    signals:       list[Signal]
    coins_scanned: int
    duration_ms:   int
    signals_found: int
    errors:        int = 0
