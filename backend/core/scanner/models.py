"""
Pydantic models for the scanner core engine.
Mirror of types/index.ts — kept in sync so the API layer can serialise
either side without conversion.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal

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


class TechnicalIndicators(BaseModel):
    rsi:           float
    macd:          MACDResult
    ema20:         float
    ema50:         float
    atr:           float
    volume_spike:  float
    current_price: float
    trend:         TrendDirection


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
    """Minimal coin fields used by the risk engine."""
    id:               str
    symbol:           str
    name:             str
    price:            float
    market_cap:       float
    volume_24h:       float
    price_change_24h: float
    rank:             int
    image:            str = ""


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
