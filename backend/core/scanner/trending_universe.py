"""
Trending Opportunity Universe — Phase 7.3A.2 / 7.3A.3.

Phase 7.3A.2: Multi-source candidate DISCOVERY.
  Fuses 5 data sources to build a deduplicated coin pool.

Phase 7.3A.3: PRIORITIZATION via TrendScore.
  After discovery, each candidate is scored by the TrendScore engine
  (trend_score.py) and the final list is sorted by trend_score descending.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISCOVERY SOURCES  (Phase 7.3A.2)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1. Founder Watchlist   — 40 pts   (founder intent, highest priority)
  2. CMC Trending API    — 30 pts   (CMC algorithm, 20 coins)
  3. Top Movers          — 20 pts   (top 10 by absolute 24h change)
  4. CMC Rising Sectors  — 15 pts   (coins in top-3 sectors, avgChange > 3%)
  5. Listings Universe   —  5 pts   (baseline top-100 market cap)

  Multi-source bonus: +5 pts per additional source (max +15).
  Relative strength and volume bonuses applied to discovery_score.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TREND SCORE  (Phase 7.3A.3)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  See trend_score.py for the full 7-component formula.
  Final candidate ordering uses trend_score, not discovery_score.
  discovery_score is kept for attribution and telemetry only.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTIMATED COVERAGE IMPROVEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Old: price_change_24h > 5% OR volume/mcap > 8%  (~30-40% coverage)
  New: 5-source fusion + TrendScore prioritization (~70-80% coverage)
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum

from backend.core.scanner.intelligence_cache import (
    read_categories,
    read_top_movers,
    read_trending_coins,
)
from backend.core.scanner.models import CoinData
from backend.core.scanner.trend_score import TrendScoreComponents, compute_trend_score
from backend.logging.setup import get_logger

log = get_logger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

RISING_SECTOR_THRESHOLD = 3.0   # avgPriceChange % to qualify as "rising"
TOP_RISING_SECTORS      = 3     # how many rising sectors to include
MULTI_SOURCE_BONUS      = 5     # discovery_score pts per additional source


class TrendingSource(str, Enum):
    WATCHLIST    = "watchlist"
    CMC_TRENDING = "cmc_trending"
    TOP_MOVER    = "top_mover"
    CMC_CATEGORY = "cmc_category"
    LISTINGS     = "listings"


_SOURCE_SCORES: dict[TrendingSource, int] = {
    TrendingSource.WATCHLIST:    40,
    TrendingSource.CMC_TRENDING: 30,
    TrendingSource.TOP_MOVER:    20,
    TrendingSource.CMC_CATEGORY: 15,
    TrendingSource.LISTINGS:      5,
}


# ── Data models ───────────────────────────────────────────────────────────────

@dataclass
class TrendingMeta:
    # Discovery (Phase 7.3A.2)
    symbol:            str
    discovery_score:   float          # 0-100 composite from source attribution
    discovery_sources: list[str]      # e.g. ["cmc_trending", "cmc_category:defi"]
    primary_source:    str            # highest-weight discovery source
    sector:            str | None     # CMC category name (if categorised)
    relative_strength: float          # coin_change_24h − btc_change_24h

    # TrendScore inputs (Phase 7.3A.3)
    trending_list_rank: int | None    # 1-based position in CMC trending list
    sector_avg_change:  float | None  # avgPriceChange of coin's CMC category
    price_change_1h:    float | None  # from CMC trending snapshot (None if not available)

    # TrendScore output (Phase 7.3A.3)
    trend_score:            float                    # 0-100 final priority score
    trend_score_components: TrendScoreComponents     # per-component breakdown


@dataclass
class TrendingUniverseResult:
    coins:             list[CoinData]          # ordered by trend_score descending
    meta:              dict[str, TrendingMeta] # keyed by UPPER symbol
    source_counts:     dict[str, int]          # hits per TrendingSource
    new_from_trending: int                     # coins added from CMC trending (outside top-100)
    rising_sectors:    list[str]               # sector names that triggered category boost


# ── Internal helpers ──────────────────────────────────────────────────────────

def _coin_from_trending_dict(tc: dict) -> CoinData:
    """
    Convert a raw TrendingSnapshot coin dict to CoinData.
    price=0.0 — not in the snapshot; signal entry always comes from Binance klines.
    """
    symbol = str(tc.get("symbol", "")).upper()
    return CoinData(
        id=str(tc.get("id", "")),
        symbol=symbol,
        name=str(tc.get("name", symbol)),
        rank=int(tc.get("rank") or 999),
        price=0.0,
        market_cap=float(tc.get("marketCap") or 0),
        volume_24h=float(tc.get("volume24h") or 0),
        price_change_24h=float(tc.get("priceChange24h") or 0),
        binance_symbol=f"{symbol}USDT",
        has_futures=False,
        image="",
    )


def _compute_discovery_score(
    sources:          list[TrendingSource],
    price_change_24h: float,
    btc_change_24h:   float,
    volume_24h:       float,
    market_cap:       float,
) -> float:
    """Discovery score: source attribution + relative strength + volume bonus."""
    if not sources:
        return 0.0
    primary = max(sources, key=lambda s: _SOURCE_SCORES[s])
    score   = float(_SOURCE_SCORES[primary])
    score  += (len(sources) - 1) * MULTI_SOURCE_BONUS

    rel = price_change_24h - btc_change_24h
    if rel > 5:
        score += 10
    elif rel > 2:
        score += 5
    elif rel > 0:
        score += 2
    elif rel < -5:
        score -= 15
    elif rel < -2:
        score -= 5

    turnover = volume_24h / max(market_cap, 1)
    if turnover > 0.15:
        score += 10
    elif turnover > 0.10:
        score += 7
    elif turnover > 0.06:
        score += 3

    return max(0.0, min(100.0, score))


def _parse_rising_sectors(
    categories: list[dict],
) -> tuple[list[str], dict[str, str], dict[str, float]]:
    """
    Return:
      rising_names        — list of top-N sector names by avgPriceChange > threshold
      symbol_to_sector    — symbol → sector name (first rising sector wins)
      symbol_to_avg_change — symbol → sector avgPriceChange
    """
    rising = sorted(
        [c for c in categories if float(c.get("avgPriceChange") or 0) > RISING_SECTOR_THRESHOLD],
        key=lambda c: float(c.get("avgPriceChange") or 0),
        reverse=True,
    )[:TOP_RISING_SECTORS]

    names:        list[str]       = []
    sym_sector:   dict[str, str]  = {}
    sym_avg_chg:  dict[str, float] = {}

    for cat in rising:
        name    = cat.get("name", "")
        avg_chg = float(cat.get("avgPriceChange") or 0)
        names.append(name)
        for sym in cat.get("coins", []):
            s = sym.upper()
            if s not in sym_sector:
                sym_sector[s]   = name
                sym_avg_chg[s]  = avg_chg

    return names, sym_sector, sym_avg_chg


# ── Public API ────────────────────────────────────────────────────────────────

async def build_trending_universe(
    base_coins:        list[CoinData],
    btc_change_24h:    float = 0.0,
    watchlist_symbols: list[str] | None = None,
) -> TrendingUniverseResult:
    """
    Build a ranked, deduplicated trending candidate pool and apply TrendScore.

    Parameters
    ----------
    base_coins        — coins loaded from cache:intel:listings (top-100)
    btc_change_24h    — BTC 24h price change for relative-strength scoring
    watchlist_symbols — founder watchlist symbols (loaded from settings if None)

    Returns
    -------
    TrendingUniverseResult:
      .coins  — list[CoinData] ordered by trend_score descending (NOT discovery_score)
      .meta   — full TrendingMeta per symbol (both discovery + trend score)
    """
    if watchlist_symbols is None:
        try:
            from backend.system_settings.service import get_settings_service  # noqa: PLC0415
            from backend.system_settings.groups  import ScannerSettings       # noqa: PLC0415
            svc              = get_settings_service()
            scanner_cfg      = await svc.get_group(ScannerSettings)
            watchlist_symbols = getattr(scanner_cfg, "trending_watchlist", []) or []
        except Exception:
            watchlist_symbols = []

    watchlist = {s.upper() for s in watchlist_symbols if s.strip()}

    # ── Fetch all intelligence sources concurrently ───────────────────────────
    trending_raw, (categories_raw, _), top_mover_syms = await asyncio.gather(
        read_trending_coins(),
        read_categories(),
        read_top_movers(),
    )

    # Build lookup structures
    # trending_rank_map: symbol → 1-based rank in CMC trending list
    trending_rank_map: dict[str, int] = {
        t.get("symbol", "").upper(): idx + 1
        for idx, t in enumerate(trending_raw)
    }
    # trending_1h_map: symbol → priceChange1h from CMC trending snapshot
    trending_1h_map: dict[str, float] = {
        t.get("symbol", "").upper(): float(t.get("priceChange1h") or 0)
        for t in trending_raw
        if t.get("priceChange1h") is not None
    }

    top_mover_set = set(top_mover_syms)
    base_by_symbol = {c.symbol.upper(): c for c in base_coins}
    rising_sectors, category_symbol_map, category_avg_change_map = _parse_rising_sectors(
        categories_raw
    )

    # ── Build unified coin pool ───────────────────────────────────────────────
    coin_pool: dict[str, CoinData] = dict(base_by_symbol)

    new_from_trending = 0
    for tc in trending_raw:
        sym = str(tc.get("symbol", "")).upper()
        if sym and sym not in coin_pool:
            coin_pool[sym] = _coin_from_trending_dict(tc)
            new_from_trending += 1

    for sym in watchlist:
        if sym not in coin_pool:
            log.debug("watchlist_symbol_not_in_universe", symbol=sym)

    # ── Build meta and compute both scores ───────────────────────────────────
    meta:          dict[str, TrendingMeta] = {}
    source_counts: dict[str, int]          = {s.value: 0 for s in TrendingSource}

    for symbol, coin in coin_pool.items():
        sources: list[TrendingSource] = []

        if symbol in watchlist:
            sources.append(TrendingSource.WATCHLIST)
            source_counts[TrendingSource.WATCHLIST.value] += 1

        if symbol in trending_rank_map:
            sources.append(TrendingSource.CMC_TRENDING)
            source_counts[TrendingSource.CMC_TRENDING.value] += 1

        if symbol in top_mover_set:
            sources.append(TrendingSource.TOP_MOVER)
            source_counts[TrendingSource.TOP_MOVER.value] += 1

        sector = category_symbol_map.get(symbol)
        if sector:
            sources.append(TrendingSource.CMC_CATEGORY)
            source_counts[TrendingSource.CMC_CATEGORY.value] += 1

        if symbol in base_by_symbol:
            sources.append(TrendingSource.LISTINGS)
            source_counts[TrendingSource.LISTINGS.value] += 1

        if not sources:
            continue

        # Discovery score (source attribution)
        disc_score = _compute_discovery_score(
            sources, coin.price_change_24h, btc_change_24h,
            coin.volume_24h, coin.market_cap,
        )
        primary = max(sources, key=lambda s: _SOURCE_SCORES[s])
        tags    = [
            f"cmc_category:{sector}" if s == TrendingSource.CMC_CATEGORY and sector else s.value
            for s in sources
        ]

        # TrendScore (opportunity strength)
        tr_rank        = trending_rank_map.get(symbol)
        sec_avg_change = category_avg_change_map.get(symbol)
        p1h            = trending_1h_map.get(symbol)   # None if not in trending snapshot

        ts = compute_trend_score(
            trending_list_rank = tr_rank,
            relative_strength  = coin.price_change_24h - btc_change_24h,
            sector_avg_change  = sec_avg_change,
            volume_24h         = coin.volume_24h,
            market_cap         = coin.market_cap,
            price_change_1h    = p1h,
            has_futures        = coin.has_futures,
        )

        meta[symbol] = TrendingMeta(
            symbol             = symbol,
            discovery_score    = disc_score,
            discovery_sources  = tags,
            primary_source     = primary.value,
            sector             = sector,
            relative_strength  = round(coin.price_change_24h - btc_change_24h, 2),
            trending_list_rank = tr_rank,
            sector_avg_change  = sec_avg_change,
            price_change_1h    = p1h,
            trend_score            = ts.total,
            trend_score_components = ts,
        )

    # ── Sort by trend_score descending (Phase 7.3A.3 ordering) ───────────────
    ranked = sorted(
        [c for c in coin_pool.values() if c.symbol in meta],
        key=lambda c: meta[c.symbol].trend_score,
        reverse=True,
    )

    # Emit Prometheus histogram for trend score distribution
    try:
        from backend.metrics.prometheus import trend_score_histogram  # noqa: PLC0415
        for m in meta.values():
            trend_score_histogram.observe(m.trend_score)
    except Exception:
        pass

    log.info(
        "trending_universe_built",
        total_unique=len(ranked),
        new_from_cmc_trending=new_from_trending,
        rising_sectors=rising_sectors,
        source_counts=source_counts,
        watchlist_count=len(watchlist),
        top5_candidates=[
            {
                "symbol":          c.symbol,
                "trend_score":     round(meta[c.symbol].trend_score, 1),
                "discovery_score": round(meta[c.symbol].discovery_score, 1),
                "sources":         meta[c.symbol].discovery_sources,
                "ts_components":   meta[c.symbol].trend_score_components.as_dict(),
            }
            for c in ranked[:5]
        ],
    )

    return TrendingUniverseResult(
        coins=ranked,
        meta=meta,
        source_counts=source_counts,
        new_from_trending=new_from_trending,
        rising_sectors=rising_sectors,
    )
