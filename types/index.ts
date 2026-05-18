export interface CoinData {
  id: string;
  symbol: string;
  name: string;
  rank: number;
  price: number;
  marketCap: number;
  volume24h: number;
  priceChange24h: number;
  binanceSymbol: string;
  hasFutures: boolean;
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

export interface TechnicalIndicators {
  rsi: number;
  macd: MACDResult;
  ema20: number;
  ema50: number;
  atr: number;
  volumeSpike: number;
  currentPrice: number;
  trend: 'BULLISH' | 'BEARISH' | 'RANGING';
}

export type SignalType = 'BUY' | 'SELL' | 'NEUTRAL';
export type ScannerMode = 'spot' | 'futures' | 'high_confidence' | 'trending';
export type Timeframe = '15m' | '1h' | '4h' | '1d';
export type RiskGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface RiskViolation {
  code:     string;
  message:  string;
  severity: 'CRITICAL' | 'HIGH';
}

export interface RiskWarning {
  code:    string;
  message: string;
}

export interface TradingSignal {
  id?: string;
  scanRunId?: string;
  symbol: string;
  name: string;
  type: SignalType;
  timeframe: Timeframe;
  scannerMode: ScannerMode;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  rrRatio: number;
  confidence: number;
  indicators: TechnicalIndicators;
  setupDescription: string;
  aiValidated: boolean;
  aiReasoning?: string;
  risks?: string[];
  strengths?: string[];
  telegramSent: boolean;
  createdAt: Date;
  // Risk engine fields
  riskScore?:              number;
  qualityScore?:           number;
  riskGrade?:              RiskGrade;
  riskWarnings?:           RiskWarning[];
  maxSafeLeverage?:        number;
  positionSizeMultiplier?: number;
  // Futures intelligence
  futuresData?:            FuturesData;
}

export interface ScanRun {
  id?: string;
  mode: ScannerMode;
  startedAt: Date;
  completedAt?: Date;
  coinsScanned: number;
  signalsFound: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

export interface AIValidationResult {
  confidence: number;
  validated: boolean;
  reasoning: string;
  risks: string[];
  strengths: string[];
}

export interface ScannerConfig {
  minMarketCap: number;
  minVolume24h: number;
  minRRRatio: number;
  minConfidence: number;
  maxCoinsToScan: number;
  timeframes: Timeframe[];
  scannerMode: ScannerMode;
}

export interface ScanResult {
  scanRunId: string | null;
  signals: TradingSignal[];
  coinsScanned: number;
  duration: number;
  mode: ScannerMode;
}

export interface DashboardStats {
  totalScanned: number;
  totalSignals: number;
  highConfSignals: number;
  lastScanTime: Date | null;
  isScanning: boolean;
}

// ─── Backtesting ─────────────────────────────────────────────────────────────

export type BacktestOutcome    = 'WIN' | 'LOSS' | 'TIMEOUT';
export type BacktestExitReason = 'TP_HIT' | 'SL_HIT' | 'TIMEOUT';

export interface BacktestTrade {
  id?:                  string;
  backtestRunId?:       string;
  symbol:               string;
  type:                 'BUY' | 'SELL';
  entryPrice:           number;
  exitPrice:            number;
  stopLoss:             number;
  takeProfit:           number;
  rrRatio:              number;
  outcome:              BacktestOutcome;
  pnlPct:               number;
  entryTime:            Date;
  exitTime?:            Date;
  durationCandles:      number;
  exitReason:           BacktestExitReason;
  rsiAtEntry?:          number;
  volumeSpikeAtEntry?:  number;
}

export interface BacktestMetrics {
  totalTrades:        number;
  winRate:            number;
  lossRate:           number;
  timeoutRate:        number;
  avgRR:              number;
  profitFactor:       number;
  totalReturn:        number;
  maxDrawdown:        number;
  avgWin:             number;
  avgLoss:            number;
  bestTrade:          number;
  worstTrade:         number;
  sharpeRatio:        number;
  avgDurationCandles: number;
  equityCurve:        number[];
}

export interface BacktestConfig {
  mode:            ScannerMode;
  lookbackDays:    number;
  maxHoldCandles:  number;
  strategyName:    string;
  minRRRatio?:     number;
  maxCoins?:       number;
}

export interface BacktestRun {
  id?:           string;
  strategyName:  string;
  mode:          ScannerMode;
  coinsTested:   number;
  totalTrades:   number;
  status:        'running' | 'completed' | 'failed';
  metrics?:      BacktestMetrics;
  config:        BacktestConfig;
  startedAt:     Date;
  completedAt?:  Date;
  error?:        string;
}

// ─── Futures Intelligence ────────────────────────────────────────────────────

export interface LiquidationZone {
  price:       number;
  side:        'LONG_LIQ' | 'SHORT_LIQ';
  strength:    'WEAK' | 'MODERATE' | 'STRONG';
  distancePct: number;
}

export interface BreakoutSignal {
  detected:        boolean;
  direction:       'UP' | 'DOWN';
  breakoutPct:     number;
  rangeHigh:       number;
  rangeLow:        number;
  volumeConfirmed: boolean;
  ageCandles:      number;
}

export interface TrendContinuationData {
  isPullback:              boolean;
  pullbackDepth:           number;
  holdingKeyLevel:         boolean;
  keyLevel:                number;
  continuationConfidence:  number;
}

export interface FuturesData {
  fundingRate:           number;
  fundingRateAnnualized: number;
  fundingBias:           'LONG_HEAVY' | 'SHORT_HEAVY' | 'NEUTRAL';
  openInterest:          number;
  oiChange24h:           number;
  oiTrend:               'RISING' | 'FALLING' | 'STABLE';
  longShortRatio?:       number;
  longAccountPercent?:   number;
  shortAccountPercent?:  number;
  liquidationZones:      LiquidationZone[];
  momentumScore:         number;
  breakout?:             BreakoutSignal;
  trendContinuation:     TrendContinuationData;
}

// ─── Telegram alert event types ─────────────────────────────────────────────

export interface TPHitEvent {
  signal: TradingSignal;
  tpLevel: 1 | 2 | 3;
  hitPrice: number;
  hitTime: Date;
}

export interface SLHitEvent {
  signal: TradingSignal;
  hitPrice: number;
  hitTime: Date;
}

export interface DailySummaryData {
  date: string;           // e.g. "May 17, 2026"
  totalScans: number;
  coinsAnalyzed: number;
  totalSignals: number;
  highConfSignals: number;
  buySignals: number;
  sellSignals: number;
  bestSignal?: TradingSignal;
}

// ─── SaaS / Monetisation ─────────────────────────────────────────────────────

export type PlanId = 'free' | 'pro' | 'enterprise';

export interface Plan {
  id:                    PlanId;
  name:                  string;
  minSignalConfidence:   number;
  dailySignalLimit:      number;    // -1 = unlimited
  monthlyApiCalls:       number;    // -1 = unlimited
  maxScanTriggers:       number;    // per day; -1 = unlimited
  allowedModes:          ScannerMode[];
  features:              string[];
}

export interface AppUser {
  id:                    string;
  email:                 string;
  planId:                PlanId;
  stripeCustomerId?:     string;
  stripeSubscriptionId?: string;
  subscriptionStatus:    'active' | 'trialing' | 'past_due' | 'canceled' | 'none';
  planExpiresAt?:        Date;
  createdAt:             Date;
}

export interface ApiKey {
  id:          string;
  userId:      string;
  keyHash:     string;
  keyPrefix:   string;   // first 8 chars of raw key (safe to display)
  name:        string;
  lastUsedAt?: Date;
  createdAt:   Date;
  revokedAt?:  Date;
}

export interface UsageRecord {
  id:               string;
  userId:           string;
  period:           string;   // "YYYY-MM"
  apiCalls:         number;
  signalsViewed:    number;
  scansTriggered:   number;
  updatedAt:        Date;
}

export interface AccessContext {
  userId:    string;
  planId:    PlanId;
  plan:      Plan;
  apiKeyId?: string;
}

export interface QuotaStatus {
  plan:          Plan;
  period:        string;
  usage:         UsageRecord;
  remaining: {
    apiCalls:       number;  // -1 = unlimited
    signalsPerDay:  number;  // -1 = unlimited
    scansPerDay:    number;  // -1 = unlimited
  };
}
