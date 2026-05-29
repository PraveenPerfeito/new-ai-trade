"""
Trend Score Engine — Phase 7.3A.3.

Computes a 0-100 composite score for each trending candidate to drive scan
PRIORITIZATION.  This is not signal generation — no klines are fetched here.
All inputs come from the CMC intelligence cache and the coin metadata already
available at the start of a scan cycle.

═══════════════════════════════════════════════════════════════
FORMULA  (total 100 pts)
═══════════════════════════════════════════════════════════════

Component               Weight  Rationale
──────────────────────  ──────  ──────────────────────────────
CMC Trending Rank          20   CMC's own algorithm independently confirms demand
Relative Strength vs BTC   25   Outperforming BTC = genuine demand, not noise
Sector Strength            15   Narrative/sector rotation sustains moves
Volume Expansion           20   Expanding volume validates the price move
Market Cap Tier             8   $10B-$100B large-caps have liquidity + upside
Breakout Momentum          10   1h acceleration confirms intraday conviction
Futures Availability        2   Perpetual futures = institutional access + liquidity
──────────────────────  ──────
Total                     100

═══════════════════════════════════════════════════════════════
COMPONENT SCALES
═══════════════════════════════════════════════════════════════

1. CMC TRENDING RANK (0–20 pts)
   Position in CMC /cryptocurrency/trending/latest (1 = most trending):
     rank  1–5   →  20 pts   (top tier)
     rank  6–10  →  15 pts
     rank 11–20  →   8 pts
     not trending →  0 pts

2. RELATIVE STRENGTH VS BTC (0–25 pts)
   rel = coin_change_24h − btc_change_24h:
     rel > +10%   →  25 pts   (strong outperformance)
     rel >  +5%   →  20 pts
     rel >  +2%   →  14 pts
     rel >   0%   →   8 pts
     rel > -2%    →   4 pts   (slight underperformance)
     rel ≤ -2%    →   0 pts   (underperforming)

3. SECTOR STRENGTH (0–15 pts)
   avgPriceChange of the coin's CMC category:
     > +7%          →  15 pts   (very strong sector)
     > +4%          →  12 pts
     > +2%          →   8 pts
     > +0%          →   4 pts
     ≤  0%          →   0 pts   (weak/falling sector)
     unknown (None) →   5 pts   (neutral — no category data available)

4. VOLUME EXPANSION (0–20 pts)
   turnover = volume_24h / market_cap:
     > 20%   →  20 pts   (explosive volume)
     > 12%   →  16 pts
     >  8%   →  12 pts
     >  5%   →   8 pts
     >  2%   →   4 pts
     ≤  2%   →   0 pts

5. MARKET CAP TIER (0–8 pts)
   $10B–$100B large-caps have best risk/reward for trending plays.
   market_cap:
     > $100B (mega)     →  5 pts   (good but limited upside)
     $10B–$100B (large) →  8 pts   ← sweet spot
     $1B–$10B  (mid)    →  6 pts
     $200M–$1B (small)  →  4 pts
     < $200M   (micro)  →  1 pt    (liquidity risk)

6. BREAKOUT MOMENTUM (0–10 pts)
   1-hour price change (from CMC trending snapshot if available; else proxy).
   price_change_1h:
     > +3%            →  10 pts   (strong intraday breakout)
     > +1.5%          →   8 pts
     > +0.5%          →   5 pts
     > 0%             →   3 pts   (mild positive)
     ≤ 0% or unknown  →   0 pts

7. FUTURES AVAILABILITY (0–2 pts)
   has_futures = True  →  2 pts
   has_futures = False →  0 pts

═══════════════════════════════════════════════════════════════
VALIDATION EXAMPLES
═══════════════════════════════════════════════════════════════

Example A — NEAR (strong trending coin):
  CMC trending rank 3, sector=layer-1 avgChange=5.2%,
  coin_change_24h=+8.1%, BTC_change_24h=+2.2% → rel=+5.9%
  volume_24h=$1.2B, market_cap=$9.5B → turnover=12.6%
  price_change_1h=+2.1%, has_futures=True

  CMC Trending Rank:    20 pts  (rank 1-5)
  Relative Strength:    20 pts  (rel +5.9% > +5%)
  Sector Strength:      12 pts  (avgChange 5.2% → 4-7% tier)
  Volume Expansion:     16 pts  (12.6% → 12-20% tier)
  Market Cap Tier:       6 pts  ($9.5B → $1B-$10B mid)
  Breakout Momentum:     8 pts  (1h +2.1% → 1.5-3% tier)
  Futures Availability:  2 pts
  ───────────────────────────
  TrendScore:           84 / 100

Example B — DOGE (not trending, weak sector):
  Not in CMC trending, sector=meme avgChange=-1.2%
  coin_change_24h=+0.8%, BTC_change_24h=+2.2% → rel=-1.4%
  volume_24h=$1.1B, market_cap=$28B → turnover=3.9%
  price_change_1h=-0.3%, has_futures=True

  CMC Trending Rank:     0 pts  (not trending)
  Relative Strength:     4 pts  (rel -1.4% → -2% to 0% tier)
  Sector Strength:       0 pts  (avgChange -1.2% ≤ 0%)
  Volume Expansion:      4 pts  (3.9% → 2-5% tier)
  Market Cap Tier:       8 pts  ($28B → $10B-$100B large — sweet spot)
  Breakout Momentum:     0 pts  (1h -0.3% ≤ 0%)
  Futures Availability:  2 pts
  ───────────────────────────
  TrendScore:           18 / 100   (low priority — not a trending candidate)

Example C — FIL (on founder watchlist, moderate momentum):
  Not in CMC trending (but on watchlist), sector=storage avgChange=4.1%
  coin_change_24h=+3.5%, BTC_change_24h=+2.2% → rel=+1.3%
  volume_24h=$420M, market_cap=$2.8B → turnover=15%
  price_change_1h=+0.8%, has_futures=True

  Note: discovery_score would be HIGH (watchlist=40pts) but TrendScore
  reflects actual trend quality independently of how the coin was discovered.

  CMC Trending Rank:     0 pts  (not trending)
  Relative Strength:     8 pts  (rel +1.3% → 0-2% tier)
  Sector Strength:      12 pts  (avgChange 4.1% → 4-7% tier)
  Volume Expansion:     18 pts  (15% → 12-20% tier)
  Market Cap Tier:       6 pts  ($2.8B → $1B-$10B mid)
  Breakout Momentum:     5 pts  (1h +0.8% → 0.5-1.5% tier)
  Futures Availability:  2 pts
  ───────────────────────────
  TrendScore:           51 / 100   (moderate — worth scanning)

═══════════════════════════════════════════════════════════════
INTEGRATION
═══════════════════════════════════════════════════════════════

TrendScore is computed inside build_trending_universe() (trending_universe.py)
after the discovery universe is built. Candidates are then sorted by trend_score
descending before being passed to _filter_coins() and the signal pipeline.

discovery_score  — answers "was this coin flagged by multiple sources?"
trend_score      — answers "how strong is the trend signal right now?"

Final scan order: sort by trend_score (discovery_score kept for attribution only).
"""
from __future__ import annotations

from dataclasses import dataclass


# ── Component weights ─────────────────────────────────────────────────────────
# Each represents the maximum contribution from that component.
# They must sum to exactly 100.

W_CMC_TRENDING_RANK = 20
W_RELATIVE_STRENGTH = 25
W_SECTOR_STRENGTH   = 15
W_VOLUME_EXPANSION  = 20
W_MARKET_CAP_TIER   =  8
W_BREAKOUT_MOMENTUM = 10
W_FUTURES_BONUS     =  2

assert (
    W_CMC_TRENDING_RANK + W_RELATIVE_STRENGTH + W_SECTOR_STRENGTH
    + W_VOLUME_EXPANSION + W_MARKET_CAP_TIER + W_BREAKOUT_MOMENTUM
    + W_FUTURES_BONUS
) == 100, "TrendScore component weights must sum to 100"


# ── Output model ──────────────────────────────────────────────────────────────

@dataclass
class TrendScoreComponents:
    """Per-component breakdown for telemetry and explanation."""
    cmc_trending_rank: float   # 0–20
    relative_strength: float   # 0–25
    sector_strength:   float   # 0–15
    volume_expansion:  float   # 0–20
    market_cap_tier:   float   # 0–8
    breakout_momentum: float   # 0–10
    futures_bonus:     float   # 0–2
    total:             float   # 0–100

    def as_dict(self) -> dict:
        return {
            "cmc_trending_rank": self.cmc_trending_rank,
            "relative_strength": self.relative_strength,
            "sector_strength":   self.sector_strength,
            "volume_expansion":  self.volume_expansion,
            "market_cap_tier":   self.market_cap_tier,
            "breakout_momentum": self.breakout_momentum,
            "futures_bonus":     self.futures_bonus,
            "total":             self.total,
        }


# ── Component calculators ─────────────────────────────────────────────────────

def _score_cmc_trending_rank(rank: int | None) -> float:
    """0–20 pts based on position in CMC trending list (1 = most trending)."""
    if rank is None:
        return 0.0
    if rank <= 5:
        return 20.0
    if rank <= 10:
        return 15.0
    if rank <= 20:
        return 8.0
    return 0.0


def _score_relative_strength(rel: float) -> float:
    """0–25 pts based on coin_change_24h − btc_change_24h."""
    if rel > 10:
        return 25.0
    if rel > 5:
        return 20.0
    if rel > 2:
        return 14.0
    if rel > 0:
        return 8.0
    if rel > -2:
        return 4.0
    return 0.0


def _score_sector_strength(avg_change: float | None) -> float:
    """0–15 pts based on sector avgPriceChange. None = no category data (neutral 5)."""
    if avg_change is None:
        return 5.0    # neutral — no sector data available
    if avg_change > 7:
        return 15.0
    if avg_change > 4:
        return 12.0
    if avg_change > 2:
        return 8.0
    if avg_change > 0:
        return 4.0
    return 0.0


def _score_volume_expansion(volume_24h: float, market_cap: float) -> float:
    """0–20 pts based on volume_24h / market_cap turnover ratio."""
    turnover = volume_24h / max(market_cap, 1)
    if turnover > 0.20:
        return 20.0
    if turnover > 0.12:
        return 16.0
    if turnover > 0.08:
        return 12.0
    if turnover > 0.05:
        return 8.0
    if turnover > 0.02:
        return 4.0
    return 0.0


def _score_market_cap_tier(market_cap: float) -> float:
    """0–8 pts. Sweet spot: $10B–$100B large-caps."""
    if market_cap >= 100_000_000_000:   # > $100B mega
        return 5.0
    if market_cap >= 10_000_000_000:    # $10B–$100B large
        return 8.0
    if market_cap >= 1_000_000_000:     # $1B–$10B mid
        return 6.0
    if market_cap >= 200_000_000:       # $200M–$1B small
        return 4.0
    return 1.0                          # < $200M micro


def _score_breakout_momentum(price_change_1h: float | None) -> float:
    """0–10 pts based on 1h price change. None = no 1h data available (0 pts)."""
    if price_change_1h is None:
        return 0.0
    if price_change_1h > 3:
        return 10.0
    if price_change_1h > 1.5:
        return 8.0
    if price_change_1h > 0.5:
        return 5.0
    if price_change_1h > 0:
        return 3.0
    return 0.0


def _score_futures(has_futures: bool) -> float:
    """0–2 pts. Perpetual futures = institutional access + additional liquidity."""
    return 2.0 if has_futures else 0.0


# ── Public API ────────────────────────────────────────────────────────────────

def compute_trend_score(
    trending_list_rank: int | None,
    relative_strength:  float,
    sector_avg_change:  float | None,
    volume_24h:         float,
    market_cap:         float,
    price_change_1h:    float | None,
    has_futures:        bool,
) -> TrendScoreComponents:
    """
    Compute the full TrendScore for a single candidate.

    Parameters
    ----------
    trending_list_rank : 1-based position in CMC trending list, or None
    relative_strength  : coin_change_24h - btc_change_24h
    sector_avg_change  : avgPriceChange of the coin's CMC category, or None
    volume_24h         : 24-hour trading volume (USD)
    market_cap         : market capitalisation (USD)
    price_change_1h    : 1-hour price change %, or None if not available
    has_futures        : True if Binance perpetual futures exist for this coin

    Returns
    -------
    TrendScoreComponents with per-component breakdown and total 0–100.
    """
    cmc   = _score_cmc_trending_rank(trending_list_rank)
    rel   = _score_relative_strength(relative_strength)
    sec   = _score_sector_strength(sector_avg_change)
    vol   = _score_volume_expansion(volume_24h, market_cap)
    mcap  = _score_market_cap_tier(market_cap)
    brk   = _score_breakout_momentum(price_change_1h)
    fut   = _score_futures(has_futures)

    total = min(100.0, cmc + rel + sec + vol + mcap + brk + fut)

    return TrendScoreComponents(
        cmc_trending_rank = round(cmc,  2),
        relative_strength = round(rel,  2),
        sector_strength   = round(sec,  2),
        volume_expansion  = round(vol,  2),
        market_cap_tier   = round(mcap, 2),
        breakout_momentum = round(brk,  2),
        futures_bonus     = round(fut,  2),
        total             = round(total, 2),
    )
