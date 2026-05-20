import { CoinData } from '@/types';
import { getMarketDataService } from './market-data/service';

/**
 * Fetch top 100 coins — delegates to MarketDataService which handles
 * provider selection, failover, caching, and health tracking.
 * All callers (scanner, etc.) continue to use this stable export.
 */
export async function getTop100ByMarketCap(): Promise<CoinData[]> {
  return getMarketDataService().getTopCoins(100);
}

export function filterHighVolume(coins: CoinData[], minVolume = 50_000_000): CoinData[] {
  return coins.filter(c => c.volume24h >= minVolume);
}

export function filterByLiquidity(coins: CoinData[], minMarketCap = 500_000_000): CoinData[] {
  return coins.filter(c => {
    if (c.marketCap < minMarketCap) return false;
    const turnover = c.volume24h / (c.marketCap || 1);
    if (turnover < 0.005) return false;   // illiquid: <0.5% daily turnover
    if (c.priceChange24h < -50) return false; // likely rug / extreme event
    return true;
  });
}

const PRIORITY = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'SUI'];

export function prioritizeCoins(coins: CoinData[]): CoinData[] {
  return [...coins].sort((a, b) => {
    const ai = PRIORITY.indexOf(a.symbol);
    const bi = PRIORITY.indexOf(b.symbol);
    if (ai !== -1 && bi === -1) return -1;
    if (ai === -1 && bi !== -1) return 1;
    if (ai !== -1 && bi !== -1) return ai - bi;
    // fallback: combined score of volume + market cap
    const sa = a.volume24h / 1e9 * 0.6 + a.marketCap / 1e12 * 0.4;
    const sb = b.volume24h / 1e9 * 0.6 + b.marketCap / 1e12 * 0.4;
    return sb - sa;
  });
}
