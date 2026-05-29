"""
Trending Opportunity Universe — Phase 7.3A.2.

Builds a multi-source trending candidate pool by fusing all CMC intelligence
cache groups with the standard listings universe and an optional founder watchlist.

Old logic (single-source):
    price_change_24h > 5%  OR  volume/mcap > 8%
    → Catches ~30-40% of real trending opportunities. Misses CMC-trending
      coins outside top-100 and entire sector rotation narratives.

New logic (multi-source):
    Sources (highest-weight first):
      1. Founder Watchlist   — 40 pts   (explicit founder intent)
      2. CMC Trending API    — 30 pts   (CMC's own trending algorithm, 20 coins)
      3. Top Movers          — 20 pts   (top 10 by absolute 24h change from listings)
      4. CMC Rising Sectors  — 15 pts   (coins in top-3 categories by avgPriceChange > 3%)
      5. Listings Universe   — 5 pts    (baseline market-cap top-100)

    Bonuses:
      Multi-source:    +5 pts per additional source beyond the first (max +15)
      Relative strength vs BTC:
        > +5%:    +10 pts
        > +2%:    +5 pts
        > 0%:     +2 pts
        < -2%:    -5 pts
        < -5%:    -15 pts
      Volume turnover (volume_24h / market_cap):
        > 0.15:   +10 pts
        > 0.10:   +7 pts
        > 0.06:   +3 pts

    Output: list[CoinData] ordered by discovery_score descending, with
    a parallel TrendingMeta dict for attribution/logging.

    Estimated coverage improvement:
      Old: ~30-40% of trending opportunities (top-100 + basic filters)
      New: ~70-80% (adds CMC trending coins outside top-100, sector rotation,
           watchlist intent, and multi-source conviction scoring)

Example discovery attribution:
    NEAR: cmc_trending + cmc_category:layer-1 + listings  → score 55 (primary: cmc_trending)
    FIL:  watchlist + top_mover                           → score 65 (primary: watchlist)
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum

from backend.core.scanner.intelligence_cache import (
    read_top_movers,
    read_trending_coins,
    read_categories,
)
from backend.core.scanner.models import CoinData
from backend.logging.setup import get_logger

log = get_logger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

RISING_SECTOR_THRESHOLD = 3.0   # avgPriceChange % to qualify as "rising"
TOP_RISING_SECTORS      = 3     # how many rising sectors to include
MULTI_SOURCE_BONUS      = 5     # points per additional source beyond the first


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
    symbol:            str
    discovery_score:   float          # composite 0-100
    discovery_sources: list[str]      # e.g. ["cmc_trending", "cmc_category:defi", "listings"]
    primary_source:    str            # highest-weight source name
    sector:            str | None     # CMC category name if categorised
    relative_strength: float          # coin_change_24h - btc_change_24h


@dataclass
class TrendingUniverseResult:
    coins:            list[CoinData]          # ordered by discovery_score descending
    meta:             dict[str, TrendingMeta] # keyed by symbol
    source_counts:    dict[str, int]          # hits per source
    new_from_trending: int                    # coins added from CMC trending (outside top-100)
    rising_sectors:   list[str]              # sector names that triggered category boost


# ── Internal helpers ──────────────────────────────────────────────────────────

def _coin_from_trending_dict(tc: dict) -> CoinData:
    """
    Convert a raw TrendingSnapshot coin dict to CoinData.
    price is left as 0.0 — it is not in the trending snapshot.
    Signal entry/target/stop prices always come from Binance klines.
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


def _compute_score(
    sources:          list[TrendingSource],
    price_change_24h: float,
    btc_change_24h:   float,
    volume_24h:       float,
    market_cap:       float,
) -> float:
    if not sources:
        return 0.0

    # Base: highest-weight source
    primary = max(sources, key=lambda s: _SOURCE_SCORES[s])
    score   = float(_SOURCE_SCORES[primary])

    # Multi-source conviction bonus
    score += (len(sources) - 1) * MULTI_SOURCE_BONUS

    # Relative strength vs BTC
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

    # Volume turnover (liquidity quality signal)
    turnover = volume_24h / max(market_cap, 1)
    if turnover > 0.15:
        score += 10
    elif turnover > 0.10:
        score += 7
    elif turnover > 0.06:
        score += 3

    return max(0.0, min(100.0, score))


def _get_rising_sectors(categories: list[dict]) -> tuple[list[str], dict[str, str]]:
    """
    Return (rising_sector_names, symbol_to_sector_map).
    Rising = avgPriceChange > RISING_SECTOR_THRESHOLD.
    symbol_to_sector_map: symbol → sector name for coins in rising sectors.
    """
    rising = sorted(
        [c for c in categories if float(c.get("avgPriceChange") or 0) > RISING_SECTOR_THRESHOLD],
        key=lambda c: float(c.get("avgPriceChange") or 0),
        reverse=True,
    )[:TOP_RISING_SECTORS]

    sector_names: list[str]      = []
    symbol_map:   dict[str, str] = {}   # symbol → sector name

    for cat in rising:
        name = cat.get("name", "")
        sector_names.append(name)
        for sym in cat.get("coins", []):
            s = sym.upper()
            if s not in symbol_map:           # first rising sector wins
                symbol_map[s] = name

    return sector_names, symbol_map


# ── Public API ────────────────────────────────────────────────────────────────

async def build_trending_universe(
    base_coins:        list[CoinData],
    btc_change_24h:    float = 0.0,
    watchlist_symbols: list[str] | None = None,
) -> TrendingUniverseResult:
    """
    Build a ranked, deduplicated trending candidate pool from all CMC intelligence
    cache groups.

    base_coins       — coins already loaded from cache:intel:listings (top-100)
    btc_change_24h   — BTC 24h price change (used for relative strength scoring)
    watchlist_symbols — optional founder watchlist (symbols to prioritise)

    Returns TrendingUniverseResult with coins ordered by discovery_score descending.
    """
    # If no watchlist provided, try to load from system settings
    if watchlist_symbols is None:
        try:
            from backend.system_settings.service import get_settings_service  # noqa: PLC0415
            from backend.system_settings.groups  import ScannerSettings       # noqa: PLC0415
            svc             = get_settings_service()
            scanner_cfg     = await svc.get_group(ScannerSettings)
            watchlist_symbols = getattr(scanner_cfg, "trending_watchlist", []) or []
        except Exception:
            watchlist_symbols = []

    watchlist = {s.upper() for s in watchlist_symbols if s.strip()}

    # ── Fetch all data sources concurrently ───────────────────────────────────
    trending_raw, (categories_raw, _), top_mover_syms = await asyncio.gather(
        read_trending_coins(),
        read_categories(),
        read_top_movers(),
    )

    trending_symbol_set = {t.get("symbol", "").upper() for t in trending_raw}
    top_mover_set       = set(top_mover_syms)
    base_by_symbol      = {c.symbol.upper(): c for c in base_coins}
    rising_sectors, category_symbol_map = _get_rising_sectors(categories_raw)

    # ── Build unified coin pool ───────────────────────────────────────────────
    # Start with the base listings universe
    coin_pool: dict[str, CoinData] = dict(base_by_symbol)

    # Add CMC trending coins not already in the base (coins outside top-100)
    new_from_trending = 0
    for tc in trending_raw:
        sym = str(tc.get("symbol", "")).upper()
        if sym and sym not in coin_pool:
            coin_pool[sym] = _coin_from_trending_dict(tc)
            new_from_trending += 1

    # Add watchlist symbols that are in the base pool (we need price data)
    # Watchlist symbols not in base/trending are not actionable — skip them
    for sym in watchlist:
        if sym not in coin_pool:
            log.debug("watchlist_symbol_not_in_universe", symbol=sym)

    # ── Score every coin ─────────────────────────────────────────────────────
    meta:          dict[str, TrendingMeta] = {}
    source_counts: dict[str, int]          = {s.value: 0 for s in TrendingSource}

    for symbol, coin in coin_pool.items():
        sources: list[TrendingSource] = []

        if symbol in watchlist:
            sources.append(TrendingSource.WATCHLIST)
            source_counts[TrendingSource.WATCHLIST.value] += 1

        if symbol in trending_symbol_set:
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

        score   = _compute_score(
            sources,
            coin.price_change_24h,
            btc_change_24h,
            coin.volume_24h,
            coin.market_cap,
        )
        primary = max(sources, key=lambda s: _SOURCE_SCORES[s])

        # Build human-readable source tags (include sector name for categories)
        tags: list[str] = []
        for s in sources:
            if s == TrendingSource.CMC_CATEGORY and sector:
                tags.append(f"cmc_category:{sector}")
            else:
                tags.append(s.value)

        meta[symbol] = TrendingMeta(
            symbol=symbol,
            discovery_score=score,
            discovery_sources=tags,
            primary_source=primary.value,
            sector=sector,
            relative_strength=round(coin.price_change_24h - btc_change_24h, 2),
        )

    # ── Sort by discovery score descending ────────────────────────────────────
    ranked = sorted(
        [c for c in coin_pool.values() if c.symbol in meta],
        key=lambda c: meta[c.symbol].discovery_score,
        reverse=True,
    )

    log.info(
        "trending_universe_built",
        total_unique=len(ranked),
        new_from_cmc_trending=new_from_trending,
        rising_sectors=rising_sectors,
        source_counts=source_counts,
        watchlist_count=len(watchlist),
        top3_candidates=[
            {
                "symbol": c.symbol,
                "score": round(meta[c.symbol].discovery_score, 1),
                "sources": meta[c.symbol].discovery_sources,
            }
            for c in ranked[:3]
        ],
    )

    return TrendingUniverseResult(
        coins=ranked,
        meta=meta,
        source_counts=source_counts,
        new_from_trending=new_from_trending,
        rising_sectors=rising_sectors,
    )
