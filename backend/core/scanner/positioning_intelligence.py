"""
Long/Short Positioning Intelligence Engine — Phase 7.4A.5.

═══════════════════════════════════════════════════════════════
PROBLEM SOLVED
═══════════════════════════════════════════════════════════════

Audit finding (OI score: 5/10, Futures score: 6/10):
  Long/Short ratio was fetched from Binance, stored in FuturesData,
  and then used only in two edge cases:
    BUY  and ratio < 0.8 → +8 pts
    SELL and ratio > 1.5 → +8 pts
  All other positioning states (crowded longs on a BUY signal, balanced
  positioning, moderately crowded sides) produced zero signal.

This is the contrarian positioning logic: the crowd is wrong at extremes.
When everyone is long, it's harder to squeeze higher — each new high requires
fewer and fewer buyers. When everyone is short, any upward move triggers a
cascade of short covering.

═══════════════════════════════════════════════════════════════
CLASSIFICATION THRESHOLDS
═══════════════════════════════════════════════════════════════

  The Binance globalLongShortAccountRatio is:
    ratio = accounts_long / accounts_short

    ratio > 2.0   →  EXTREME_LONG   (> 66.7% of traders are long)
    ratio 1.3–2.0 →  LONG_HEAVY     (56.5–66.7% long)
    ratio 0.8–1.3 →  BALANCED       (44.4–56.5% long)
    ratio 0.5–0.8 →  SHORT_HEAVY    (33.3–44.4% long)
    ratio < 0.5   →  EXTREME_SHORT  (< 33.3% of traders are long)

  Threshold derivation:
    ratio = 2.0 → long_pct = 200/300 = 66.7%   (2× as many longs as shorts)
    ratio = 1.3 → long_pct = 130/230 = 56.5%   (moderately long-biased)
    ratio = 0.8 → long_pct =  80/180 = 44.4%   (moderately short-biased)
    ratio = 0.5 → long_pct =  50/150 = 33.3%   (2× as many shorts as longs)

═══════════════════════════════════════════════════════════════
SCORING — CONTRARIAN LOGIC
═══════════════════════════════════════════════════════════════

  For BUY signals (fade the crowd when everyone is long):
    EXTREME_SHORT   →  +8   crowd is too short → short squeeze potential
    SHORT_HEAVY     →  +4   moderately crowded shorts → squeeze potential
    BALANCED        →   0   neutral positioning
    LONG_HEAVY      →  −4   moderately crowded longs → long squeeze risk
    EXTREME_LONG    →  −8   crowd is too long → long squeeze risk, reversion likely

  For SELL signals (fade the crowd when everyone is short):
    EXTREME_LONG    →  +8   crowd is too long → long squeeze (validates SELL)
    LONG_HEAVY      →  +4   moderately crowded longs → squeeze potential
    BALANCED        →   0   neutral positioning
    SHORT_HEAVY     →  −4   moderately crowded shorts → short squeeze risk
    EXTREME_SHORT   →  −8   crowd is too short → short squeeze (invalidates SELL)

═══════════════════════════════════════════════════════════════
VALIDATION EXAMPLES
═══════════════════════════════════════════════════════════════

  BTC BUY signal, ratio = 2.3 (EXTREME_LONG):
    Too many traders are long. Long squeeze risk is elevated.
    adj = −8 pts for BUY. Signal proceeds with tighter AI gate.
    Was: 0 pts (not captured by old threshold > 1.5 SELL-only check)

  ETH SELL signal, ratio = 2.3 (EXTREME_LONG):
    Crowd is heavily long — validates SELL. adj = +8 pts for SELL.
    Was: +8 pts (correctly captured by old ratio > 1.5 check)

  SOL BUY signal, ratio = 0.45 (EXTREME_SHORT):
    Crowd is massively short → short squeeze fuel.
    adj = +8 pts for BUY.
    Was: +8 pts (correctly captured by old ratio < 0.8 check)

  DOGE BUY signal, ratio = 1.7 (LONG_HEAVY):
    Moderately crowded longs — some squeeze risk.
    adj = −4 pts for BUY.
    Was: 0 pts (not captured — old threshold was 2.0 for EXTREME only)

  XRP SELL signal, ratio = 0.55 (SHORT_HEAVY):
    Moderately crowded shorts → short squeeze risk on SELL.
    adj = −4 pts for SELL.
    Was: 0 pts (not captured)
"""
from __future__ import annotations

from dataclasses import dataclass

from backend.core.scanner.models import PositioningContext, SignalType

# ── Thresholds ────────────────────────────────────────────────────────────────

EXTREME_LONG_THRESHOLD  = 2.0   # ratio > 2.0 → 66.7%+ of traders are long
LONG_HEAVY_THRESHOLD    = 1.3   # ratio 1.3–2.0 → 56.5–66.7% long
SHORT_HEAVY_THRESHOLD   = 0.8   # ratio 0.5–0.8 → 33.3–44.4% long
EXTREME_SHORT_THRESHOLD = 0.5   # ratio < 0.5 → <33.3% of traders are long

# ── Directional score table ───────────────────────────────────────────────────
# Outer key: SignalType value, inner key: PositioningContext value → score adjustment

_SCORE_TABLE: dict[str, dict[str, int]] = {
    "BUY": {
        PositioningContext.EXTREME_SHORT.value: +8,
        PositioningContext.SHORT_HEAVY.value:   +4,
        PositioningContext.BALANCED.value:       0,
        PositioningContext.LONG_HEAVY.value:    -4,
        PositioningContext.EXTREME_LONG.value:  -8,
    },
    "SELL": {
        PositioningContext.EXTREME_LONG.value:  +8,
        PositioningContext.LONG_HEAVY.value:    +4,
        PositioningContext.BALANCED.value:       0,
        PositioningContext.SHORT_HEAVY.value:   -4,
        PositioningContext.EXTREME_SHORT.value: -8,
    },
}


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class PositioningResult:
    context:          PositioningContext
    long_short_ratio: float
    long_pct:         float    # % of traders long (0–100)
    score_adjustment: int      # directional momentum_score modifier
    description:      str      # human-readable for signal metadata

    def as_dict(self) -> dict:
        return {
            "context":          self.context.value,
            "long_short_ratio": round(self.long_short_ratio, 3),
            "long_pct":         round(self.long_pct,         1),
            "score_adjustment": self.score_adjustment,
        }


# ── Classification ────────────────────────────────────────────────────────────

def classify_positioning(
    long_short_ratio: float,
    long_pct:         float,
    signal_type:      SignalType,
) -> PositioningResult:
    """
    Classify the long/short positioning and return a directional score adjustment.

    Parameters
    ----------
    long_short_ratio : accounts_long / accounts_short from Binance
    long_pct         : percentage of accounts holding longs (0–100)
    signal_type      : BUY or SELL — determines score direction

    Returns
    -------
    PositioningResult with context, score_adjustment, and description.
    """
    if long_short_ratio > EXTREME_LONG_THRESHOLD:
        ctx  = PositioningContext.EXTREME_LONG
        desc = (
            f"Extreme long crowding — {long_pct:.1f}% of traders long "
            f"(ratio {long_short_ratio:.2f})"
        )
    elif long_short_ratio > LONG_HEAVY_THRESHOLD:
        ctx  = PositioningContext.LONG_HEAVY
        desc = (
            f"Long-heavy positioning — {long_pct:.1f}% long "
            f"(ratio {long_short_ratio:.2f})"
        )
    elif long_short_ratio > SHORT_HEAVY_THRESHOLD:
        ctx  = PositioningContext.BALANCED
        desc = (
            f"Balanced positioning — {long_pct:.1f}% long "
            f"(ratio {long_short_ratio:.2f})"
        )
    elif long_short_ratio > EXTREME_SHORT_THRESHOLD:
        ctx  = PositioningContext.SHORT_HEAVY
        desc = (
            f"Short-heavy positioning — {long_pct:.1f}% long "
            f"(ratio {long_short_ratio:.2f})"
        )
    else:
        ctx  = PositioningContext.EXTREME_SHORT
        desc = (
            f"Extreme short crowding — {long_pct:.1f}% of traders long "
            f"(ratio {long_short_ratio:.2f})"
        )

    adj = _SCORE_TABLE.get(signal_type.value, {}).get(ctx.value, 0)

    return PositioningResult(
        context          = ctx,
        long_short_ratio = long_short_ratio,
        long_pct         = long_pct,
        score_adjustment = adj,
        description      = desc,
    )
