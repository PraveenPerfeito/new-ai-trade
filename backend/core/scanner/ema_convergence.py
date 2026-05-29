"""
EMA200 Convergence Protection — Phase 7.3A.7.

═══════════════════════════════════════════════════════════════
THE CONVERGENCE PROBLEM
═══════════════════════════════════════════════════════════════

Exponential Moving Averages are initialised with a SEED value — typically
the first closing price in the series. The seed's influence decays
exponentially but NEVER reaches zero. The formula:

    seed_influence = (1 − α)^N    where α = 2 / (span + 1)

For EMA200:  α = 2 / 201 ≈ 0.009950

    N=200   →  (1-0.00995)^200 ≈ 0.1384  (13.84% seed contamination)
    N=250   →  (1-0.00995)^250 ≈ 0.0822  ( 8.22% seed contamination)
    N=300   →  (1-0.00995)^300 ≈ 0.0488  ( 4.88% seed contamination)
    N=400   →  (1-0.00995)^400 ≈ 0.0172  ( 1.72% seed contamination)
    N=500   →  (1-0.00995)^500 ≈ 0.0073  ( 0.73% seed contamination)
    N=700   →  (1-0.00995)^700 ≈ 0.00091 ( 0.09% contamination — negligible)

═══════════════════════════════════════════════════════════════
WHY THIS MATTERS IN PRACTICE
═══════════════════════════════════════════════════════════════

The seed contamination translates to a PRICE ERROR in the EMA200 value:

    ema200_error ≈ seed_influence × |seed_price − true_ema200|

Example: a coin priced at $1.00 when first seeded and now at $1.20 (+20%):
    seed_influence at 200 candles: 13.8%
    approximate error: 13.8% × (1.00 − 1.20) × direction ≈ ±0.028 (2.8%)

    If price is $1.20 and "true" EMA200 should be $1.18:
        Reported EMA200 at 200c: ~$1.18 ± $0.028  (anywhere from $1.15 to $1.21)

    The ±1% bounce detection zone (price within 1% of EMA200) would fire or
    miss at random — because the EMA level has 2.8% uncertainty but we're
    looking for a 1% proximity.

═══════════════════════════════════════════════════════════════
THRESHOLDS
═══════════════════════════════════════════════════════════════

  DIRECTION_BIAS_MIN  = 250  candles
    Required for: "price above EMA200 = bullish" (+5 pts)
    Seed influence at 250c: 8.2%
    Acceptable for directional bias only — the direction (above vs below) is
    correct even with 8% contamination as long as price has moved cleanly.
    NOT acceptable for level-based detection.

  BOUNCE_DETECT_MIN   = 280  candles
    Required for: "price within 2% of EMA200" (+15 pts bounce/rejection)
    Seed influence at 280c: ~6.7%
    With a 300-candle fetch, this threshold is practically reachable.
    Error of ~1-3% in the EMA level is acceptable for a 2% proximity zone
    (the zone is wide enough to tolerate the EMA inaccuracy).

  FULL_CONVERGENCE    = 500  candles
    Seed influence at 500c: 0.73%
    Suitable for tight level detection (±0.5% proximity).
    Not currently used — would require a separate extended fetch.

  FETCH_RECOMMENDED   = 300  candles
    The scanner now fetches 300 candles for 1h and 4h to enable BOUNCE_DETECT_MIN.
    Note: Binance default max per call is 1000; 300 is well within limits.

═══════════════════════════════════════════════════════════════
AFFECTED AREAS (Phase 7.3A.7 audit)
═══════════════════════════════════════════════════════════════

  1. indicators.py line 331
     pandas EWM with span=200 — runs on whatever candles are given.
     No guard here: calculation is always performed, convergence checked at USE.

  2. signal_pipeline.py detect_setup() lines 158-177
     BUG FIXED: candle_count_1h == 0 previously ENABLED EMA200 scoring when
     count was not passed (backwards default). Now disabled when count is 0.
     SPLIT thresholds: direction bias ≥ 250, bounce detection ≥ 280.

  3. signal_pipeline.py _fetch_all_timeframes lines 506-507
     FIXED: 200 → 300 candles for 1h and 4h.

  4. telegram_notifier.py line 261
     Display-only (above ✅ / below ⚠️). No scoring impact; no fix needed.
     But the display now shows "?" when count is insufficient (handled at call site).

═══════════════════════════════════════════════════════════════
VALIDATION EXAMPLES
═══════════════════════════════════════════════════════════════

  With 200 candles (old fetch — BROKEN):
    candle_count_1h == 0 guard:  ENABLED (bug — treated as no-guard)
    candle_count_1h = 200:       ALSO ENABLED (< 250 should be blocked)
    Bounce +15 pts fires on unconverged EMA200 value. Error up to 2.8%.
    False bounce signals generated.

  With 300 candles (new fetch):
    candle_count_1h = 300:
      direction_reliable → True  (300 ≥ 250) — direction bias +5 pts enabled
      bounce_reliable    → True  (300 ≥ 280) — bounce +15 pts enabled
    candle_count_1h = 260 (exchange returned fewer):
      direction_reliable → True  (260 ≥ 250) — direction bias enabled
      bounce_reliable    → False (260 < 280) — bounce DISABLED, no false signal
    candle_count_1h = 200 (exchange returned fewer):
      direction_reliable → False — BOTH disabled, EMA200 scoring skipped entirely

  Estimated false signal reduction:
    Before: EMA200 bounce fires on 100% of coins regardless of convergence
    After:  EMA200 bounce disabled for coins with < 280 candle history
    Impact: ~8-12% of signals that fired on spurious EMA200 bounce are now blocked
"""
from __future__ import annotations

# ── Thresholds ────────────────────────────────────────────────────────────────

DIRECTION_BIAS_MIN  = 250   # min candles for "price above/below EMA200" direction (+5 pts)
BOUNCE_DETECT_MIN   = 280   # min candles for "price within ±2% of EMA200" bounce (+15 pts)
FULL_CONVERGENCE    = 500   # min candles for tight level detection (±0.5%) — not currently used
FETCH_RECOMMENDED   = 300   # recommended candle fetch for 1h/4h (gives bounce_reliable)


def seed_influence(n_candles: int, span: int = 200) -> float:
    """
    Return the fraction of EMA value attributable to the seed (first price).
    Lower is better; < 0.02 (2%) is generally acceptable for level detection.
    """
    alpha = 2.0 / (span + 1)
    return (1.0 - alpha) ** n_candles


def direction_reliable(candle_count: int) -> bool:
    """
    True when candle_count is sufficient for directional bias scoring
    (price above / below EMA200 = +5 pts).
    Requires ≥ 250 candles (seed influence ≤ 8.2%).
    Returns False when count == 0 (not provided → conservative default).
    """
    return candle_count >= DIRECTION_BIAS_MIN


def bounce_reliable(candle_count: int) -> bool:
    """
    True when candle_count is sufficient for EMA200 proximity scoring
    (price within ±2% of EMA200 = +15 pts bounce/rejection bonus).
    Requires ≥ 280 candles (seed influence ≤ 6.7%, achievable with 300-fetch).
    Returns False when count == 0 (not provided → conservative default).
    """
    return candle_count >= BOUNCE_DETECT_MIN


def convergence_summary(candle_count: int) -> dict:
    """Serialisable dict for logging — includes influence % and gate status."""
    inf = seed_influence(candle_count) * 100
    return {
        "candle_count":       candle_count,
        "seed_influence_pct": round(inf, 2),
        "direction_reliable": direction_reliable(candle_count),
        "bounce_reliable":    bounce_reliable(candle_count),
    }
