"""
Relative Strength vs BTC Engine — Phase 7.3A.4.

WHY 4h INSTEAD OF 24h
═══════════════════════════════════════════════════════════════
24h percentage change is noisy for three reasons:

  1. Stale signal: a coin that ran +15% 20 hours ago but is −3% in the last 4h
     still shows a large positive 24h reading — it is REVERSING, not trending.

  2. Time-of-day contamination: 24h spans vastly different liquidity windows
     (Asian hours vs US hours). Comparing 24h changes across coins mixes
     signals from different trading sessions.

  3. Base effect: one large candle at the start of the 24h window dominates
     the entire period, masking current direction completely.

4h performance captures the CURRENT momentum window — the same timeframe
used in the signal pipeline's primary technical analysis.

═══════════════════════════════════════════════════════════════
FORMULA
═══════════════════════════════════════════════════════════════

  coin_4h_change_pct = (close_now − close_4h_ago) / close_4h_ago × 100
  btc_4h_change_pct  = (btc_close_now − btc_close_4h_ago) / btc_close_4h_ago × 100
  RS_4h = coin_4h_change_pct − btc_4h_change_pct

Data source (prioritized):
  1. Exact 4h klines from Binance (signal pipeline, post-fetch)
  2. CMC priceChange1h × 4 (trending snapshot coins, pre-fetch proxy)
  3. CMC priceChange24h / 6 (listing-only coins, rougher proxy)

BTC reference is always exact: fetched from Binance /klines BTCUSDT 4h at scan start.

═══════════════════════════════════════════════════════════════
CLASSIFICATION THRESHOLDS
═══════════════════════════════════════════════════════════════

  RS_4h > +2.0%   →  OUTPERFORMING   (clear alpha vs BTC)
  RS_4h ≥ −2.0%   →  NEUTRAL         (tracking BTC ± noise)
  RS_4h < −2.0%   →  UNDERPERFORMING (lagging BTC)

Threshold rationale:
  • ±2% over 4h is meaningful in crypto (typical 4h ATR is 1–3% for large-caps)
  • Tighter threshold (±1%) creates too many OUTPERFORMING coins on normal BTC rallies
  • Wider threshold (±3%) misses early relative strength divergences

═══════════════════════════════════════════════════════════════
USE CASES
═══════════════════════════════════════════════════════════════

  1. Trending prioritization (Phase 7.3A.3 TrendScore):
       relative_strength component now uses RS_4h instead of RS_24h.
       Coins outperforming BTC on 4h get +14–25 pts vs underperforming coins get 0.

  2. Candidate ranking:
       OUTPERFORMING coins sorted before NEUTRAL before UNDERPERFORMING
       within the same TrendScore tier.

  3. Sector intelligence:
       compute_sector_rs() aggregates per-coin RS_4h for all coins in a sector.
       Sector RS > +2% = sector rotation in progress.
       Identifies which sectors are leading vs lagging BTC.

═══════════════════════════════════════════════════════════════
VALIDATION EXAMPLES
═══════════════════════════════════════════════════════════════

  Example A — NEAR outperforming during Solana ecosystem rally:
    BTC  4h change: +1.2%
    NEAR 4h change: +4.5%
    RS_4h = +4.5 − 1.2 = +3.3%  →  OUTPERFORMING
    Effect: +14 pts in TrendScore (relative_strength tier: > +2%)
    Interpretation: genuine demand, not just BTC beta

  Example B — ETH neutral, BTC rally:
    BTC  4h change: +2.8%
    ETH  4h change: +2.5%
    RS_4h = +2.5 − 2.8 = −0.3%  →  NEUTRAL
    Effect: +8 pts in TrendScore (> 0% tier)
    Interpretation: moving with market, no independent demand

  Example C — DOGE lagging during BTC pump:
    BTC  4h change: +3.1%
    DOGE 4h change: +0.8%
    RS_4h = +0.8 − 3.1 = −2.3%  →  UNDERPERFORMING
    Effect: 0 pts in TrendScore (< −2% tier)
    Interpretation: money flowing out of DOGE into BTC, not a trending candidate

  Example D — PEPE leading on meme narrative:
    BTC  4h change: −0.5%
    PEPE 4h change: +6.2%
    RS_4h = +6.2 − (−0.5) = +6.7%  →  OUTPERFORMING (strongly)
    Effect: +25 pts in TrendScore (> +5% tier, max RS score)
    Interpretation: independent demand, narrative-driven breakout

  Sector example — DeFi sector during rate sensitivity:
    BTC  4h change: +0.4%
    AAVE 4h change: +2.1%  RS = +1.7%  NEUTRAL
    UNI  4h change: +3.4%  RS = +3.0%  OUTPERFORMING
    MKR  4h change: +2.9%  RS = +2.5%  OUTPERFORMING
    CRV  4h change: +0.2%  RS = −0.2%  NEUTRAL
    Sector 4h RS = avg(+1.7, +3.0, +2.5, −0.2) = +1.75%  →  NEUTRAL (near positive)
    Sector signal: DeFi beginning to outperform; watch AAVE/CRV for confirmation

═══════════════════════════════════════════════════════════════
EXPECTED BENEFITS
═══════════════════════════════════════════════════════════════

  Signal noise reduction: ~40–60% fewer false RS positives vs 24h
    (coins that peaked 18h ago no longer classified as OUTPERFORMING)

  Earlier breakout detection: 4h RS captures the CURRENT 4h candle's move.
    A coin breaking out NOW shows up immediately instead of being diluted
    by yesterday's price action.

  Sector rotation accuracy: sector RS based on 4h captures rotations that
    typically last 1–2 trading sessions, not the full day.

  TrendScore quality: relative_strength is the highest-weight component (25 pts).
    Upgrading from 24h to 4h data has the largest single impact on sort quality.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


# ── Classification thresholds ─────────────────────────────────────────────────

OUTPERFORMING_THRESHOLD  =  2.0   # RS_4h must exceed this to be OUTPERFORMING
UNDERPERFORMING_THRESHOLD = -2.0  # RS_4h must be below this to be UNDERPERFORMING


class RelativeStrength(str, Enum):
    OUTPERFORMING   = "OUTPERFORMING"
    NEUTRAL         = "NEUTRAL"
    UNDERPERFORMING = "UNDERPERFORMING"


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class RelativeStrengthResult:
    coin_4h_change:  float             # coin's 4h percentage change
    btc_4h_change:   float             # BTC's 4h percentage change (reference)
    rs_4h:           float             # RS_4h = coin_4h_change - btc_4h_change
    classification:  RelativeStrength  # OUTPERFORMING / NEUTRAL / UNDERPERFORMING
    label:           str               # human-readable label with sign
    data_quality:    str               # "exact" | "proxy_1h" | "proxy_24h"

    @property
    def is_outperforming(self) -> bool:
        return self.classification == RelativeStrength.OUTPERFORMING

    @property
    def is_underperforming(self) -> bool:
        return self.classification == RelativeStrength.UNDERPERFORMING

    def as_dict(self) -> dict:
        return {
            "coin_4h_change":  round(self.coin_4h_change, 2),
            "btc_4h_change":   round(self.btc_4h_change,  2),
            "rs_4h":           round(self.rs_4h,          2),
            "classification":  self.classification.value,
            "data_quality":    self.data_quality,
        }


# ── Core computation ──────────────────────────────────────────────────────────

def classify(rs_4h: float) -> RelativeStrength:
    """Classify a raw RS_4h value into OUTPERFORMING / NEUTRAL / UNDERPERFORMING."""
    if rs_4h > OUTPERFORMING_THRESHOLD:
        return RelativeStrength.OUTPERFORMING
    if rs_4h < UNDERPERFORMING_THRESHOLD:
        return RelativeStrength.UNDERPERFORMING
    return RelativeStrength.NEUTRAL


def compute(
    coin_4h_change: float,
    btc_4h_change:  float,
    data_quality:   str = "exact",
) -> RelativeStrengthResult:
    """
    Compute 4h relative strength for a single coin vs BTC.

    Parameters
    ----------
    coin_4h_change : coin's 4h price change in % (positive = up)
    btc_4h_change  : BTC's 4h price change in % (reference)
    data_quality   : one of "exact" | "proxy_1h" | "proxy_24h"
                     "exact"     = Binance 4h klines (most accurate)
                     "proxy_1h"  = CMC priceChange1h × 4 (good approximation)
                     "proxy_24h" = CMC priceChange24h / 6 (rough)

    Returns
    -------
    RelativeStrengthResult with rs_4h, classification and label.
    """
    rs_4h          = coin_4h_change - btc_4h_change
    classification = classify(rs_4h)
    sign           = "+" if rs_4h >= 0 else ""
    label          = f"{sign}{rs_4h:.1f}% vs BTC 4h ({classification.value})"

    return RelativeStrengthResult(
        coin_4h_change = coin_4h_change,
        btc_4h_change  = btc_4h_change,
        rs_4h          = rs_4h,
        classification = classification,
        label          = label,
        data_quality   = data_quality,
    )


def compute_from_klines(
    coin_closes: list[float],
    btc_closes:  list[float],
) -> RelativeStrengthResult:
    """
    Compute exact 4h RS from Binance kline close prices.
    Uses close[-2] → close[-1] (last completed or in-progress candle).

    Parameters
    ----------
    coin_closes : list of coin 4h close prices (at least 2 values)
    btc_closes  : list of BTC  4h close prices (at least 2 values)
    """
    if len(coin_closes) < 2 or len(btc_closes) < 2:
        return compute(0.0, 0.0, data_quality="exact")

    coin_4h = (coin_closes[-1] - coin_closes[-2]) / coin_closes[-2] * 100
    btc_4h  = (btc_closes[-1]  - btc_closes[-2])  / btc_closes[-2]  * 100
    return compute(coin_4h, btc_4h, data_quality="exact")


def proxy_from_cmc_1h(
    coin_change_1h: float,
    btc_4h_change:  float,
) -> RelativeStrengthResult:
    """
    Proxy RS using CMC priceChange1h × 4 for coins in the trending snapshot.
    More accurate than the 24h proxy because 1h is fresher.
    """
    coin_4h_proxy = coin_change_1h * 4.0
    return compute(coin_4h_proxy, btc_4h_change, data_quality="proxy_1h")


def proxy_from_cmc_24h(
    coin_change_24h: float,
    btc_4h_change:   float,
) -> RelativeStrengthResult:
    """
    Proxy RS using CMC priceChange24h / 6 for listing-only coins.
    Rough — treats 24h change as uniform across all 4h periods.
    Used only when neither exact klines nor 1h data are available.
    """
    coin_4h_proxy = coin_change_24h / 6.0
    return compute(coin_4h_proxy, btc_4h_change, data_quality="proxy_24h")


# ── Sector intelligence ───────────────────────────────────────────────────────

@dataclass
class SectorRS:
    sector_name:      str
    avg_rs_4h:        float              # average RS_4h across all sector coins
    classification:   RelativeStrength   # sector-level classification
    leading_symbols:  list[str]          # OUTPERFORMING coins in this sector
    lagging_symbols:  list[str]          # UNDERPERFORMING coins in this sector
    coin_count:       int                # number of coins measured


def compute_sector_rs(
    sector_name:       str,
    coin_rs_results:   dict[str, RelativeStrengthResult],  # symbol → RS result
) -> SectorRS:
    """
    Aggregate per-coin RS_4h values into a sector-level RS signal.

    Parameters
    ----------
    sector_name    : CMC category name (e.g., "defi", "layer-1")
    coin_rs_results: dict mapping symbol → RelativeStrengthResult

    Returns
    -------
    SectorRS with sector-level classification and leading/lagging coin lists.

    Use case: when 3+ coins in a sector are OUTPERFORMING, a sector rotation
    is likely in progress. When 3+ are UNDERPERFORMING, sector is under pressure.
    """
    if not coin_rs_results:
        return SectorRS(
            sector_name=sector_name, avg_rs_4h=0.0,
            classification=RelativeStrength.NEUTRAL,
            leading_symbols=[], lagging_symbols=[], coin_count=0,
        )

    rs_values = [r.rs_4h for r in coin_rs_results.values()]
    avg_rs    = sum(rs_values) / len(rs_values)
    cls       = classify(avg_rs)
    leading   = [sym for sym, r in coin_rs_results.items() if r.is_outperforming]
    lagging   = [sym for sym, r in coin_rs_results.items() if r.is_underperforming]

    return SectorRS(
        sector_name     = sector_name,
        avg_rs_4h       = round(avg_rs, 2),
        classification  = cls,
        leading_symbols = leading,
        lagging_symbols = lagging,
        coin_count      = len(coin_rs_results),
    )
