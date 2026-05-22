import { CoinData, SectorName, SectorStats, SectorMomentum, ClusteringState, TradingSignal } from '@/types';

// ─── Static coin → sector mapping (top-100 coverage) ─────────────────────────

const SECTOR_MAP: Record<string, SectorName> = {
  // BTC
  BTC: 'BTC',

  // L1 / L2
  ETH: 'L1/L2', SOL: 'L1/L2', ADA: 'L1/L2', AVAX: 'L1/L2',
  DOT: 'L1/L2', NEAR: 'L1/L2', ATOM: 'L1/L2', TRX: 'L1/L2',
  APT: 'L1/L2', SUI: 'L1/L2', TON: 'L1/L2', ALGO: 'L1/L2',
  HBAR: 'L1/L2', ICP: 'L1/L2', FTM: 'L1/L2', ONE: 'L1/L2',
  EGLD: 'L1/L2', KLAY: 'L1/L2', FLOW: 'L1/L2', ROSE: 'L1/L2',
  MATIC: 'L1/L2', OP: 'L1/L2', ARB: 'L1/L2', STRK: 'L1/L2',
  SEI: 'L1/L2', INJ: 'L1/L2', TIA: 'L1/L2', OSMO: 'L1/L2',

  // DeFi
  UNI: 'DeFi', AAVE: 'DeFi', CRV: 'DeFi', MKR: 'DeFi',
  COMP: 'DeFi', SUSHI: 'DeFi', YFI: 'DeFi', BAL: 'DeFi',
  LDO: 'DeFi', PENDLE: 'DeFi', SNX: 'DeFi', GMX: 'DeFi',
  DYDX: 'DeFi', CAKE: 'DeFi', JOE: 'DeFi', RUNE: 'DeFi',
  RAY: 'DeFi', JUP: 'DeFi', PYTH: 'DeFi',

  // AI
  FET: 'AI', AGIX: 'AI', OCEAN: 'AI', RENDER: 'AI', RNDR: 'AI',
  TAO: 'AI', WLD: 'AI', AKT: 'AI', NMR: 'AI', IO: 'AI',
  ARKM: 'AI', GNO: 'AI',

  // Meme
  DOGE: 'Meme', SHIB: 'Meme', PEPE: 'Meme', WIF: 'Meme',
  BONK: 'Meme', FLOKI: 'Meme', BRETT: 'Meme', MEME: 'Meme',
  MOG: 'Meme', COQ: 'Meme', TURBO: 'Meme', BABYDOGE: 'Meme',

  // Gaming / Metaverse
  AXS: 'Gaming', SAND: 'Gaming', MANA: 'Gaming', IMX: 'Gaming',
  GALA: 'Gaming', BEAM: 'Gaming', SUPER: 'Gaming', ILV: 'Gaming',
  GODS: 'Gaming', ENJ: 'Gaming',

  // Infrastructure / Oracle / Storage
  LINK: 'Infrastructure', GRT: 'Infrastructure', FIL: 'Infrastructure',
  AR: 'Infrastructure', API3: 'Infrastructure', BAND: 'Infrastructure',
  VET: 'Infrastructure', STORJ: 'Infrastructure', HNT: 'Infrastructure',

  // RWA / Institutional
  ONDO: 'RWA', CFG: 'RWA', RIO: 'RWA',

  // Exchange tokens
  BNB: 'Exchange', OKB: 'Exchange', CRO: 'Exchange', KCS: 'Exchange',
  HT: 'Exchange', GT: 'Exchange',

  // Privacy
  XMR: 'Privacy', ZEC: 'Privacy', DASH: 'Privacy', SCRT: 'Privacy',

  // Payments / Value Transfer
  XRP: 'Payments', LTC: 'Payments', BCH: 'Payments', XLM: 'Payments',
  XDC: 'Payments', NANO: 'Payments',
};

export function classifySector(symbol: string): SectorName {
  return SECTOR_MAP[symbol.toUpperCase()] ?? 'Other';
}

// ─── Sector stats computation from coin data ──────────────────────────────────

export function computeSectorStats(coins: CoinData[]): SectorStats[] {
  const byName: Record<string, CoinData[]> = {};

  for (const coin of coins) {
    const sector = classifySector(coin.symbol);
    if (!byName[sector]) byName[sector] = [];
    byName[sector].push(coin);
  }

  const stats: SectorStats[] = Object.entries(byName)
    .filter(([, coinList]) => coinList.length > 0)
    .map(([name, coinList]) => {
      const gainers    = coinList.filter(c => c.priceChange24h > 0).length;
      const breadth    = gainers / coinList.length;
      const avgChange  = coinList.reduce((s, c) => s + c.priceChange24h, 0) / coinList.length;

      let momentum: SectorMomentum;
      if      (avgChange > 5  && breadth > 0.70) momentum = 'ACCELERATING';
      else if (avgChange > 0  && breadth >= 0.50) momentum = 'STABLE';
      else if (avgChange < -5 && breadth < 0.30) momentum = 'REVERSING';
      else                                        momentum = 'DECELERATING';

      return {
        name:         name as SectorName,
        coinCount:    coinList.length,
        gainers,
        losers:       coinList.length - gainers,
        breadth,
        avgChange24h: parseFloat(avgChange.toFixed(2)),
        momentum,
        rank:         0, // set after sort
      };
    })
    .sort((a, b) => b.avgChange24h - a.avgChange24h)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  return stats;
}

// ─── Signal clustering detection ──────────────────────────────────────────────

export function detectClustering(signals: TradingSignal[]): ClusteringState {
  if (signals.length < 5) return { detected: false, concentration: 0 };

  const counts: Partial<Record<SectorName, number>> = {};
  for (const sig of signals) {
    const sector = sig.sectorName ?? classifySector(sig.symbol);
    counts[sector] = (counts[sector] ?? 0) + 1;
  }

  let dominant: SectorName | undefined;
  let maxCount = 0;
  for (const [sector, count] of Object.entries(counts)) {
    if (count > maxCount) { maxCount = count; dominant = sector as SectorName; }
  }

  const concentration = maxCount / signals.length;
  const detected      = concentration >= 0.40 && signals.length >= 5;

  return {
    detected,
    dominantSector: detected ? dominant : undefined,
    concentration,
    warning: detected && dominant
      ? `${Math.round(concentration * 100)}% of signals are ${dominant} — potential herd clustering`
      : undefined,
  };
}
