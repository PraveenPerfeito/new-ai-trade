"""
Institutional Open Interest Intelligence Engine — Phase 7.4A.2.

═══════════════════════════════════════════════════════════════
PROBLEM SOLVED
═══════════════════════════════════════════════════════════════

Audit finding (OI score: 5/10):
  - Price ↑ + OI ↓ (short covering) was treated as neutral
  - Price ↓ + OI ↑ (new shorts) was treated same as Price ↑ + OI ↑ (new longs)
  - LONG_LIQUIDATION cascade risk was invisible to the scoring engine
  - OI was scored by raw magnitude alone, not by what it MEANS

The raw OI scoring:
    oi_change_24h > 5%: +10 pts (correct if price is also up, wrong if price is down)
    oi_change_24h < -5%: -8 pts (wrong — falling OI on a rising price = short squeeze)

═══════════════════════════════════════════════════════════════
CLASSIFICATION MATRIX
═══════════════════════════════════════════════════════════════

  Price  │  OI   │  Interpretation   │  Meaning
  ────────────────────────────────────────────────────────────
    ↑    │   ↑   │  NEW_LONGS        │  New money entering long. Strongest BUY confirmation.
    ↓    │   ↑   │  NEW_SHORTS       │  New money entering short. Strongest SELL confirmation.
    ↑    │   ↓   │  SHORT_COVERING   │  Shorts exiting, not new longs. Move may exhaust early.
    ↓    │   ↓   │  LONG_LIQUIDATION │  Longs being stopped out. Bearish cascade risk.
  flat   │ flat  │  NEUTRAL          │  No clear institutional positioning change.

═══════════════════════════════════════════════════════════════
SCORING  (applied to futures momentum_score)
═══════════════════════════════════════════════════════════════

  For BUY signals:
    NEW_LONGS        → +10  confirmation: new institutional long interest
    NEUTRAL          →   0  no signal
    SHORT_COVERING   →  −5  warning: move driven by short exits, not new buyers
    NEW_SHORTS       → −10  contra-flow: new money is entering on the short side
    LONG_LIQUIDATION →  −5  warning: prior longs being liquidated, cascade risk

  For SELL signals:
    NEW_SHORTS       → +10  confirmation: new institutional short interest
    NEUTRAL          →   0  no signal
    LONG_LIQUIDATION →  −5  warning: overextended bearish move, squeeze risk
    NEW_LONGS        → −10  contra-flow: new money is entering on the long side
    SHORT_COVERING   →  −5  warning: shorts are fleeing, not ideal for new shorts

═══════════════════════════════════════════════════════════════
THRESHOLDS
═══════════════════════════════════════════════════════════════

  PRICE_THRESHOLD = 0.5%   minimum price change to be classified as directional
  OI_THRESHOLD    = 1.0%   minimum OI change to be classified as directional

  Both thresholds exclude noise from small overnight drifts or rounding.
  Below threshold = NEUTRAL (no strong conviction signal).

═══════════════════════════════════════════════════════════════
VALIDATION EXAMPLES
═══════════════════════════════════════════════════════════════

  BTC BUY signal — price_change_24h = +3.2%, oi_change_24h = +6.8%:
    price_up=True, oi_up=True → NEW_LONGS → +10 pts
    "New institutional long interest (price +3.2%, OI +6.8%)"

  SOL SELL signal — price_change_24h = −4.1%, oi_change_24h = +8.2%:
    price_dn=True, oi_up=True → NEW_SHORTS → +10 pts for SELL
    "New institutional short interest (price −4.1%, OI +8.2%)"

  ETH BUY signal — price_change_24h = +2.8%, oi_change_24h = −5.3%:
    price_up=True, oi_dn=True → SHORT_COVERING → −5 pts
    "Short covering rally — OI falling while price rises (price +2.8%, OI −5.3%)"

  DOGE SELL signal — price_change_24h = −3.5%, oi_change_24h = −7.1%:
    price_dn=True, oi_dn=True → LONG_LIQUIDATION → −5 pts for SELL
    "Long liquidation cascade — elevated short squeeze risk (price −3.5%, OI −7.1%)"

  XRP BUY signal — price_change_24h = +0.2%, oi_change_24h = +0.8%:
    below thresholds → NEUTRAL → 0 pts
"""
from __future__ import annotations

from dataclasses import dataclass

from backend.core.scanner.models import OIInterpretation, SignalType

# ── Thresholds ────────────────────────────────────────────────────────────────

PRICE_THRESHOLD = 0.5   # % price change to classify as directional
OI_THRESHOLD    = 1.0   # % OI change to classify as directional

# ── Directional score table ───────────────────────────────────────────────────
# Outer key: SignalType value, inner key: OIInterpretation value → score adjustment

_SCORE_TABLE: dict[str, dict[str, int]] = {
    "BUY": {
        OIInterpretation.NEW_LONGS.value:        +10,
        OIInterpretation.SHORT_COVERING.value:    -5,
        OIInterpretation.LONG_LIQUIDATION.value:  -5,
        OIInterpretation.NEW_SHORTS.value:       -10,
        OIInterpretation.NEUTRAL.value:            0,
    },
    "SELL": {
        OIInterpretation.NEW_SHORTS.value:       +10,
        OIInterpretation.LONG_LIQUIDATION.value:  -5,
        OIInterpretation.SHORT_COVERING.value:    -5,
        OIInterpretation.NEW_LONGS.value:        -10,
        OIInterpretation.NEUTRAL.value:            0,
    },
}


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class OIAnalysisResult:
    interpretation:   OIInterpretation
    price_change_24h: float
    oi_change_24h:    float
    score_adjustment: int     # directional momentum_score modifier
    description:      str     # human-readable for signal metadata

    def as_dict(self) -> dict:
        return {
            "interpretation":   self.interpretation.value,
            "price_change_24h": round(self.price_change_24h, 2),
            "oi_change_24h":    round(self.oi_change_24h,    2),
            "score_adjustment": self.score_adjustment,
        }


# ── Core classifier ───────────────────────────────────────────────────────────

def classify_oi(
    price_change_24h: float,
    oi_change_24h:    float,
    signal_type:      SignalType,
) -> OIAnalysisResult:
    """
    Classify the relationship between 24h price movement and 24h OI movement
    and return a directional momentum score adjustment.

    Parameters
    ----------
    price_change_24h : 24h price % change (positive = up)
    oi_change_24h    : 24h open interest % change (positive = rising)
    signal_type      : BUY or SELL — determines which side of the score table

    Returns
    -------
    OIAnalysisResult with interpretation, score_adjustment, and description.
    """
    price_up = price_change_24h >  PRICE_THRESHOLD
    price_dn = price_change_24h < -PRICE_THRESHOLD
    oi_up    = oi_change_24h    >  OI_THRESHOLD
    oi_dn    = oi_change_24h    < -OI_THRESHOLD

    if price_up and oi_up:
        interp = OIInterpretation.NEW_LONGS
        desc   = (
            f"New institutional long interest "
            f"(price {price_change_24h:+.1f}%, OI {oi_change_24h:+.1f}%)"
        )
    elif price_dn and oi_up:
        interp = OIInterpretation.NEW_SHORTS
        desc   = (
            f"New institutional short interest "
            f"(price {price_change_24h:+.1f}%, OI {oi_change_24h:+.1f}%)"
        )
    elif price_up and oi_dn:
        interp = OIInterpretation.SHORT_COVERING
        desc   = (
            f"Short covering rally — OI falling while price rises "
            f"(price {price_change_24h:+.1f}%, OI {oi_change_24h:+.1f}%)"
        )
    elif price_dn and oi_dn:
        interp = OIInterpretation.LONG_LIQUIDATION
        desc   = (
            f"Long liquidation cascade — elevated short squeeze risk "
            f"(price {price_change_24h:+.1f}%, OI {oi_change_24h:+.1f}%)"
        )
    else:
        interp = OIInterpretation.NEUTRAL
        desc   = (
            f"Neutral OI positioning "
            f"(price {price_change_24h:+.1f}%, OI {oi_change_24h:+.1f}%)"
        )

    sig_key = signal_type.value
    adj     = _SCORE_TABLE.get(sig_key, {}).get(interp.value, 0)

    return OIAnalysisResult(
        interpretation   = interp,
        price_change_24h = price_change_24h,
        oi_change_24h    = oi_change_24h,
        score_adjustment = adj,
        description      = desc,
    )
