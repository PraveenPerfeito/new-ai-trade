import { CoinData } from '@/types';
import {
  CmcListingCoin,
  CmcGlobalMetrics,
  CmcTrendingCoin,
  CmcCategory,
} from './cmc-client';
import {
  ListingsSnapshot,
  GlobalSnapshot,
  TrendingSnapshot,
  CategoriesSnapshot,
  TrendingCoin,
  CategoryData,
} from './types';

// ─── Listings ─────────────────────────────────────────────────────────────────

export function normalizeListings(raw: CmcListingCoin[]): ListingsSnapshot {
  const coins: CoinData[] = raw.map((c) => ({
    id:            String(c.id),
    symbol:        c.symbol,
    name:          c.name,
    rank:          c.cmc_rank,
    price:         c.quote.USD.price,
    marketCap:     c.quote.USD.market_cap,
    volume24h:     c.quote.USD.volume_24h,
    priceChange24h: c.quote.USD.percent_change_24h,
    binanceSymbol: `${c.symbol}USDT`,
    hasFutures:    false, // enriched downstream by Binance
  }));

  const movers = [...coins]
    .sort((a, b) => Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h))
    .slice(0, 10)
    .map((c) => ({ symbol: c.symbol, change: c.priceChange24h }));

  const up   = coins.filter((c) => c.priceChange24h > 0).length;
  const down = coins.filter((c) => c.priceChange24h < 0).length;

  return {
    coins,
    breadthUp:   Math.round((up   / coins.length) * 1000) / 10,
    breadthDown: Math.round((down / coins.length) * 1000) / 10,
    topMovers:   movers,
    refreshedAt: new Date().toISOString(),
  };
}

// ─── Global metrics ───────────────────────────────────────────────────────────

export function normalizeGlobal(raw: CmcGlobalMetrics): GlobalSnapshot {
  const usd = raw.quote.USD;
  return {
    btcDominance:               raw.btc_dominance,
    ethDominance:               raw.eth_dominance,
    totalMarketCapUsd:          usd.total_market_cap,
    totalVolume24hUsd:          usd.total_volume_24h,
    marketCapChangePercent24h:  usd.total_market_cap_yesterday_percentage_change,
    activeCurrencies:           raw.active_cryptocurrencies,
    updatedAt:                  raw.last_updated,
    refreshedAt:                new Date().toISOString(),
  };
}

// ─── Trending ─────────────────────────────────────────────────────────────────

export function normalizeTrending(raw: CmcTrendingCoin[]): TrendingSnapshot {
  const trending: TrendingCoin[] = raw.map((c) => ({
    id:            c.id,
    symbol:        c.symbol,
    name:          c.name,
    rank:          c.cmc_rank,
    priceChange1h:  c.quote.USD.percent_change_1h,
    priceChange24h: c.quote.USD.percent_change_24h,
    volume24h:      c.quote.USD.volume_24h,
    marketCap:      c.quote.USD.market_cap,
  }));
  return { trending, refreshedAt: new Date().toISOString() };
}

// ─── Categories ───────────────────────────────────────────────────────────────

export function normalizeCategories(raw: CmcCategory[]): CategoriesSnapshot {
  const categories: CategoryData[] = raw.map((c) => ({
    id:              c.id,
    name:            c.name,
    title:           c.title,
    coinCount:       c.num_tokens,
    avgPriceChange:  c.avg_price_change,
    volume24h:       c.volume,
    marketCap:       c.market_cap,
    marketCapChange: c.market_cap_change,
    coins:           c.coins ?? [],
  }));

  const sorted = [...categories].sort((a, b) => b.avgPriceChange - a.avgPriceChange);
  return {
    categories,
    strongest:   sorted[0]?.name ?? '',
    weakest:     sorted[sorted.length - 1]?.name ?? '',
    refreshedAt: new Date().toISOString(),
  };
}

