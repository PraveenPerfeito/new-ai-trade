"""
Futures Funding Calibration Engine — Phase 7.3A.6.

═══════════════════════════════════════════════════════════════
THE PROBLEM WITH THE OLD LOGIC
═══════════════════════════════════════════════════════════════

Old (Phase 7.3A.1 after fix):
    if abs(funding_rate) > 0.005:
        HARD REJECT

Problems:
  1. Not directional — a SELL signal with funding_rate = +0.006 is FAVORABLE
     (longs paying shorts, which BENEFITS short sellers). The old code rejected it.

  2. Threshold too low — 0.5%/8h is elevated but not extreme. Binance perpetuals
     routinely sustain 0.3–0.8%/8h during active trending markets.

  3. No graduated response — no penalty tier between "accept" and "reject".
     A signal with 0.004 funding got the same treatment as one with 0.001.

═══════════════════════════════════════════════════════════════
NEW LOGIC — DIRECTIONAL CONTEXT
═══════════════════════════════════════════════════════════════

Step 1: Compute the ADVERSE funding component (direction-aware):
  BUY  signal: adverse = max(0, +funding_rate)   [positive rate = longs paying = BAD for longs]
  SELL signal: adverse = max(0, -funding_rate)   [negative rate = shorts paying = BAD for shorts]

  Favorable is the opposite:
  BUY  signal: favorable = max(0, -funding_rate) [negative rate = paid to hold long = GOOD]
  SELL signal: favorable = max(0, +funding_rate) [positive rate = paid to hold short = GOOD]

Step 2: Classify into 4 contexts:
  FAVORABLE   adverse < 0.0005 AND favorable ≥ 0.001 — being paid to hold, rare opportunity
  NORMAL      adverse ≤ 0.003 (0.3%/8h, ~8.2% annualised) — standard market
  ELEVATED    adverse 0.003–0.007 (0.3–0.7%/8h, 8–19% ann.) — crowded but tradeable
  EXTREME     adverse > 0.007 (0.7%/8h, > 19% ann.) — position too crowded, hard reject

Step 3: Apply outcome:
  FAVORABLE   +3 setup_score bonus (paid to hold reduces effective cost)
  NORMAL       0 setup_score adjustment
  ELEVATED   −10 setup_score penalty (warning: scan proceeds, harder AI gate)
  EXTREME     hard reject (return None from signal pipeline)

═══════════════════════════════════════════════════════════════
THRESHOLDS — DERIVATION
═══════════════════════════════════════════════════════════════

  Binance perps funding history (8h intervals):
    Neutral markets:      0.005–0.010% (= 0.00005–0.0001)
    Normal bull market:   0.050–0.100% (= 0.0005–0.001)
    Active bull market:   0.100–0.300% (= 0.001–0.003)   ← NORMAL ceiling
    Peak trending market: 0.300–0.700% (= 0.003–0.007)   ← ELEVATED range
    Extreme (meme runs):  0.700–3.000% (= 0.007–0.030)   ← EXTREME

  The old threshold of 0.5%/8h (0.005) sits at the boundary of ELEVATED and EXTREME
  by real-world data — far too aggressive as a hard rejection point.

═══════════════════════════════════════════════════════════════
VALIDATION EXAMPLES
═══════════════════════════════════════════════════════════════

  BUY signal, funding_rate = +0.006 (0.6%/8h — longs paying):
    adverse = max(0, +0.006) = 0.006  → ELEVATED
    Effect: -10 pts. Scan continues with harder AI gate. Was previously REJECTED.
    Old: REJECT. New: WARNING (penalty).

  SELL signal, funding_rate = +0.006 (longs paying, shorts receiving):
    adverse = max(0, -0.006) = 0  → FAVORABLE
    favorable = max(0, +0.006) = 0.006 ≥ 0.001  → FAVORABLE
    Effect: +3 pts. Shorts are being paid to hold. This was previously REJECTED as
    abs(0.006) > 0.005. Now correctly identified as a FAVORABLE condition.

  BUY signal, funding_rate = +0.009 (extreme):
    adverse = max(0, +0.009) = 0.009 > 0.007  → EXTREME
    Effect: HARD REJECT. Position too crowded; cost to hold is prohibitive.

  BUY signal, funding_rate = -0.002 (negative, shorts paying longs):
    adverse = max(0, -0.002) = 0  → not ELEVATED
    favorable = max(0, +0.002) = 0.002 ≥ 0.001  → FAVORABLE
    Effect: +3 pts. BTC-style negative funding = rare contrarian opportunity.

  BUY signal, funding_rate = +0.002 (longs paying, normal):
    adverse = max(0, +0.002) = 0.002 ≤ 0.003  → NORMAL
    Effect: 0 pts. Standard market condition.

═══════════════════════════════════════════════════════════════
ESTIMATED INCREASE IN FUTURES OPPORTUNITIES
═══════════════════════════════════════════════════════════════

  Old threshold (hard reject at abs > 0.005):
    Rejected: funding_rate in (-∞, -0.005) ∪ (0.005, +∞)
    Direction-blind: SELL signals with +0.006 funding were rejected (actually favorable).

  New thresholds (directional, hard reject at adverse > 0.007):
    Recovered as ELEVATED (penalty, not rejection):
      BUY signals with funding 0.005–0.007 (now process with -10 pts)
      SELL signals with funding 0.005–0.007 positive (now FAVORABLE, +3 pts)
    Recovered as FAVORABLE:
      Signals where funding opposes the crowd (negative for BUY, positive for SELL)

  Estimated impact:
    • ~15–25% more futures candidates proceed to AI validation
    • Of those, ~60% pass AI gate (ELEVATED penalty makes them harder, not impossible)
    • Net increase in accepted futures signals: ~10–15%
    • Directional correction restores an additional ~5–8% (SELL signals with pos. funding)
    • Total estimated signal increase: ~15–22%

═══════════════════════════════════════════════════════════════
RISK ANALYSIS
═══════════════════════════════════════════════════════════════

  Why ELEVATED is safe to allow (with penalty):
    • AI Claude validation is the final gate — it factors in the signal quality holistically
    • The -10 pt penalty raises the effective bar: only high-quality setups survive
    • The funding rate is visible in the AI prompt (via FuturesData), so Claude can
      still reject crowded positions independently of our pre-filter
    • Outcome tracking (signal_outcomes table) will reveal empirically whether
      ELEVATED signals have worse win rates → threshold calibration over time

  Why EXTREME hard-rejects (adverse > 0.007):
    • 0.7%/8h = 19% annualised cost to hold. Even a 5% move pays back in 1.8 days,
      but if the trade takes longer the cost erodes profit significantly.
    • At 0.7%/8h, mean reversion pressure on the funding rate itself tends to
      work against the position — the market is priced for correction.

  Directional correction does NOT increase risk:
    • SELL signals with positive funding were incorrectly rejected before.
      Positive funding for SELL means longs are paying shorts = favorable.
      Restoring these is fixing a bug, not adding risk.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


# ── Thresholds (8h funding rate in decimal form, e.g. 0.003 = 0.3%/8h) ────────

EXTREME_ADV_THRESHOLD   = 0.007   # adverse > 0.7%/8h → EXTREME → hard reject
ELEVATED_ADV_THRESHOLD  = 0.003   # adverse > 0.3%/8h → ELEVATED → -10 pts penalty
FAVORABLE_THRESHOLD     = 0.001   # favorable ≥ 0.1%/8h → FAVORABLE → +3 pts bonus

# Phase 7.4A.4 — funding trend adjustments to adverse_rate before classification
# RISING:  multiply adverse by 1.3 (crowding accelerating → more dangerous)
# FALLING: multiply adverse by 0.7 (crowding unwinding → less dangerous)
TREND_RISING_MULTIPLIER  = 1.3
TREND_FALLING_MULTIPLIER = 0.7

# Setup score adjustments
_ADJ: dict[str, int] = {
    "FAVORABLE": +3,
    "NORMAL":     0,
    "ELEVATED":  -10,
    "EXTREME":    0,   # N/A — hard reject, score irrelevant
}


class FundingContext(str, Enum):
    FAVORABLE = "FAVORABLE"
    NORMAL    = "NORMAL"
    ELEVATED  = "ELEVATED"
    EXTREME   = "EXTREME"


@dataclass
class FundingAnalysis:
    funding_rate:    float           # raw 8h funding rate (positive = longs pay)
    adverse_rate:    float           # directional adverse component
    favorable_rate:  float           # directional favorable component
    context:         FundingContext
    signal_dir:      str             # "long" or "short"
    annualized_pct:  float           # human-readable annualised cost/income
    setup_score_adj: int             # additive adjustment to setup.pre_score
    should_reject:   bool            # True only for EXTREME
    log_message:     str             # structured log note

    @property
    def is_favorable(self) -> bool:
        return self.context == FundingContext.FAVORABLE

    @property
    def is_elevated(self) -> bool:
        return self.context == FundingContext.ELEVATED

    @property
    def is_extreme(self) -> bool:
        return self.context == FundingContext.EXTREME

    def as_dict(self) -> dict:
        return {
            "funding_rate":    round(self.funding_rate,   6),
            "adverse_rate":    round(self.adverse_rate,   6),
            "favorable_rate":  round(self.favorable_rate, 6),
            "context":         self.context.value,
            "annualized_pct":  round(self.annualized_pct, 2),
            "setup_score_adj": self.setup_score_adj,
            "should_reject":   self.should_reject,
        }


def classify_funding(
    funding_rate:  float,
    is_buy:        bool,
    funding_trend: str = "STABLE",   # Phase 7.4A.4: "RISING" | "FALLING" | "STABLE"
) -> FundingAnalysis:
    """
    Classify the funding rate context for a futures signal.

    Parameters
    ----------
    funding_rate  : 8h funding rate in decimal (e.g. 0.001 = 0.1%/8h)
    is_buy        : True for BUY signal, False for SELL
    funding_trend : Phase 7.4A.4 — direction of funding over last 3 readings.
                    RISING  → multiply adverse by 1.3 (crowding accelerating)
                    FALLING → multiply adverse by 0.7 (crowding unwinding)
                    STABLE  → no adjustment (default, backward-compatible)

    Returns
    -------
    FundingAnalysis with context, setup_score_adj, and should_reject.
    """
    # Directional decomposition
    if is_buy:
        adverse   = max(0.0, funding_rate)    # positive rate = longs paying = BAD for longs
        favorable = max(0.0, -funding_rate)   # negative rate = shorts paying = GOOD for longs
    else:
        adverse   = max(0.0, -funding_rate)   # negative rate = shorts paying = BAD for shorts
        favorable = max(0.0, funding_rate)    # positive rate = longs paying = GOOD for shorts

    # Phase 7.4A.4: adjust adverse_rate based on funding trend before classification
    if funding_trend == "RISING":
        adverse = adverse * TREND_RISING_MULTIPLIER
    elif funding_trend == "FALLING":
        adverse = adverse * TREND_FALLING_MULTIPLIER

    # Classification
    if adverse > EXTREME_ADV_THRESHOLD:
        context = FundingContext.EXTREME
    elif adverse > ELEVATED_ADV_THRESHOLD:
        context = FundingContext.ELEVATED
    elif favorable >= FAVORABLE_THRESHOLD and adverse < ELEVATED_ADV_THRESHOLD:
        context = FundingContext.FAVORABLE
    else:
        context = FundingContext.NORMAL

    direction    = "long" if is_buy else "short"
    ann_pct      = funding_rate * 3 * 365 * 100   # annualised % (3 periods/day × 365)
    adj          = _ADJ[context.value]
    should_rej   = context == FundingContext.EXTREME

    # Human-readable log note (includes trend when non-STABLE)
    ann_str    = f"{ann_pct:+.1f}%/yr"
    trend_note = f" [trend:{funding_trend}]" if funding_trend != "STABLE" else ""
    if context == FundingContext.EXTREME:
        msg = (f"funding_extreme: adverse={adverse:.4f} ({ann_str}) "
               f"for {direction}{trend_note} — hard reject (too crowded to hold)")
    elif context == FundingContext.ELEVATED:
        msg = (f"funding_elevated: adverse={adverse:.4f} ({ann_str}) "
               f"for {direction}{trend_note} — {adj:+d} pts penalty, AI gate tightened")
    elif context == FundingContext.FAVORABLE:
        msg = (f"funding_favorable: favorable={favorable:.4f} ({ann_str}) "
               f"for {direction}{trend_note} — {adj:+d} pts bonus, paid to hold position")
    else:
        msg = f"funding_normal: rate={funding_rate:.4f} ({ann_str}){trend_note}"

    return FundingAnalysis(
        funding_rate    = funding_rate,
        adverse_rate    = round(adverse,   6),
        favorable_rate  = round(favorable, 6),
        context         = context,
        signal_dir      = direction,
        annualized_pct  = round(ann_pct, 2),
        setup_score_adj = adj,
        should_reject   = should_rej,
        log_message     = msg,
    )
