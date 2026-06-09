import axios, { AxiosInstance } from 'axios';
import { getEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const log = createLogger('lib/intelligence/cmc-client');

const CMC_BASE = 'https://pro-api.coinmarketcap.com/v1';
const TIMEOUT  = 12_000;

let _client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (_client) return _client;
  const apiKey = getEnv().COINMARKETCAP_API_KEY;
  _client = axios.create({
    baseURL: CMC_BASE,
    timeout: TIMEOUT,
    headers: {
      'X-CMC_PRO_API_KEY': apiKey,
      'Accept':            'application/json',
    },
  });
  return _client;
}

// ─── Raw response shapes (minimal — only fields we use) ───────────────────────

export interface CmcListingCoin {
  id: number;
  name: string;
  symbol: string;
  cmc_rank: number;
  quote: {
    USD: {
      price: number;
      volume_24h: number;
      percent_change_1h: number;
      percent_change_24h: number;
      percent_change_7d: number;
      market_cap: number;
      market_cap_dominance: number;
      last_updated: string;
    };
  };
}

export interface CmcGlobalMetrics {
  btc_dominance: number;
  eth_dominance: number;
  quote: {
    USD: {
      total_market_cap: number;
      total_volume_24h: number;
      total_market_cap_yesterday_percentage_change: number;
      last_updated: string;
    };
  };
  active_cryptocurrencies: number;
  last_updated: string;
}

export interface CmcTrendingCoin {
  id: number;
  name: string;
  symbol: string;
  cmc_rank: number;
  quote: {
    USD: {
      price: number;
      volume_24h: number;
      percent_change_1h: number;
      percent_change_24h: number;
      market_cap: number;
      last_updated: string;
    };
  };
}

export interface CmcCategory {
  id: string;
  name: string;
  title: string;
  num_tokens: number;
  avg_price_change: number;
  volume: number;
  market_cap: number;
  market_cap_change: number;
  coins: string[];
}

export interface CmcKeyInfo {
  credit_count_used: number;
  credit_count_left: number;
}

// ─── CMC error guard ──────────────────────────────────────────────────────────
// CMC returns 200 OK with data.data=null when the API key plan doesn't support
// the endpoint. Detect this and throw a descriptive error so workers can fall back.

function assertCmcData<T>(data: T | null | undefined, endpoint: string, status: { error_code?: number; error_message?: string } | undefined): T {
  if (data !== null && data !== undefined) return data;
  const code = status?.error_code ?? 'unknown';
  const msg  = status?.error_message ?? 'no data returned';
  throw new Error(`CMC plan restriction on ${endpoint} (code=${code}): ${msg}`);
}

// ─── Fetch functions ──────────────────────────────────────────────────────────

export async function fetchListings(limit = 100): Promise<CmcListingCoin[]> {
  const res = await getClient().get('/cryptocurrency/listings/latest', {
    params: { limit, convert: 'USD', sort: 'market_cap' },
  });
  const data = assertCmcData(res.data.data, '/listings/latest', res.data.status);
  log.debug({ count: (data as CmcListingCoin[]).length }, 'cmc_listings_fetched');
  return data as CmcListingCoin[];
}

export async function fetchGlobalMetrics(): Promise<CmcGlobalMetrics> {
  const res = await getClient().get('/global-metrics/quotes/latest', {
    params: { convert: 'USD' },
  });
  const data = assertCmcData(res.data.data, '/global-metrics/quotes/latest', res.data.status);
  log.debug('cmc_global_fetched');
  return data as CmcGlobalMetrics;
}

export async function fetchTrending(limit = 20): Promise<CmcTrendingCoin[]> {
  const res = await getClient().get('/cryptocurrency/trending/latest', {
    params: { limit, convert: 'USD' },
  });
  const data = assertCmcData(res.data.data, '/trending/latest', res.data.status);
  log.debug({ count: (data as CmcTrendingCoin[]).length }, 'cmc_trending_fetched');
  return data as CmcTrendingCoin[];
}

export async function fetchCategories(): Promise<CmcCategory[]> {
  const res = await getClient().get('/cryptocurrency/categories', {
    params: { limit: 100 },
  });
  log.debug({ count: res.data.data?.length }, 'cmc_categories_fetched');
  return res.data.data as CmcCategory[];
}

export async function fetchKeyInfo(): Promise<CmcKeyInfo> {
  const res = await getClient().get('/key/info');
  const plan = res.data.data?.usage?.current_month;
  return {
    credit_count_used: plan?.credits_used ?? 0,
    credit_count_left: plan?.credits_left ?? 0,
  };
}
