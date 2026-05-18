import axios from 'axios';
import { CoinData } from '@/types';
import { sleep } from './utils';
import { withApiRetry } from './retry';

const BASE_URL = 'https://api.coingecko.com/api/v3';
const API_KEY = process.env.COINGECKO_API_KEY;

// Maps CoinGecko coin IDs → Binance USDT symbols
const BINANCE_SYMBOL_MAP: Record<string, string> = {
  'bitcoin': 'BTCUSDT',
  'ethereum': 'ETHUSDT',
  'solana': 'SOLUSDT',
  'binancecoin': 'BNBUSDT',
  'ripple': 'XRPUSDT',
  'dogecoin': 'DOGEUSDT',
  'cardano': 'ADAUSDT',
  'avalanche-2': 'AVAXUSDT',
  'chainlink': 'LINKUSDT',
  'sui': 'SUIUSDT',
  'polkadot': 'DOTUSDT',
  'shiba-inu': 'SHIBUSDT',
  'tron': 'TRXUSDT',
  'litecoin': 'LTCUSDT',
  'matic-network': 'MATICUSDT',
  'internet-computer': 'ICPUSDT',
  'bitcoin-cash': 'BCHUSDT',
  'near': 'NEARUSDT',
  'uniswap': 'UNIUSDT',
  'aptos': 'APTUSDT',
  'stellar': 'XLMUSDT',
  'monero': 'XMRUSDT',
  'ethereum-classic': 'ETCUSDT',
  'cosmos': 'ATOMUSDT',
  'filecoin': 'FILUSDT',
  'hedera-hashgraph': 'HBARUSDT',
  'arbitrum': 'ARBUSDT',
  'optimism': 'OPUSDT',
  'injective-protocol': 'INJUSDT',
  'sei-network': 'SEIUSDT',
  'the-graph': 'GRTUSDT',
  'fetch-ai': 'FETUSDT',
  'render-token': 'RENDERUSDT',
  'algorand': 'ALGOUSDT',
  'sandbox': 'SANDUSDT',
  'decentraland': 'MANAUSDT',
  'axie-infinity': 'AXSUSDT',
  'flow': 'FLOWUSDT',
  'immutable-x': 'IMXUSDT',
  'pepe': 'PEPEUSDT',
  'floki': 'FLOKIUSDT',
  'dogwifcoin': 'WIFUSDT',
  'kaspa': 'KASUSDT',
  'thorchain': 'RUNEUSDT',
  'pendle': 'PENDLEUSDT',
  'toncoin': 'TONUSDT',
  'notcoin': 'NOTUSDT',
  'ethena': 'ENAUSDT',
  'starknet': 'STRKUSDT',
  'dydx-chain': 'DYDXUSDT',
  'aave': 'AAVEUSDT',
  'maker': 'MKRUSDT',
  'curve-dao-token': 'CRVUSDT',
  'fantom': 'FTMUSDT',
  'eos': 'EOSUSDT',
  'vechain': 'VETUSDT',
  'theta-token': 'THETAUSDT',
  'gala': 'GALAUSDT',
  'worldcoin-wld': 'WLDUSDT',
  'celestia': 'TIAUSDT',
  'pyth-network': 'PYTHUSDT',
  'jupiter-exchange-solana': 'JUPUSDT',
  'bonk': 'BONKUSDT',
  'ondo-finance': 'ONDOUSDT',
  'eigenlayer': 'EIGENUSDT',
};

export async function getTop100ByMarketCap(): Promise<CoinData[]> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (API_KEY) headers['x-cg-demo-api-key'] = API_KEY;

  const coinParams = (page: number) => ({
    vs_currency:              'usd',
    order:                    'market_cap_desc',
    per_page:                 50,
    page,
    sparkline:                false,
    price_change_percentage:  '24h',
  });

  // CoinGecko free tier: two pages of 50 to get 100 coins
  const [page1, page2] = await Promise.all([
    withApiRetry(
      () => axios.get(`${BASE_URL}/coins/markets`, { headers, params: coinParams(1), timeout: 15000 }),
      'coingecko-page1',
    ),
    (async () => {
      await sleep(400); // stagger to avoid rate limit
      return withApiRetry(
        () => axios.get(`${BASE_URL}/coins/markets`, { headers, params: coinParams(2), timeout: 15000 }),
        'coingecko-page2',
      );
    })(),
  ]);

  const raw = [...page1.data, ...page2.data];

  return raw.map((coin: Record<string, unknown>, i: number): CoinData => {
    const cgId = String(coin.id).toLowerCase();
    const symbol = String(coin.symbol).toUpperCase();
    const binanceSymbol = BINANCE_SYMBOL_MAP[cgId] ?? `${symbol}USDT`;

    return {
      id: cgId,
      symbol,
      name: String(coin.name),
      rank: (coin.market_cap_rank as number) || i + 1,
      price: (coin.current_price as number) || 0,
      marketCap: (coin.market_cap as number) || 0,
      volume24h: (coin.total_volume as number) || 0,
      priceChange24h: (coin.price_change_percentage_24h as number) || 0,
      binanceSymbol,
      hasFutures: false,
    };
  });
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
