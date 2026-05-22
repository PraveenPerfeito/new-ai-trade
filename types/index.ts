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

// ─── Phase 6.2 — Adaptive Quant Intelligence ─────────────────────────────────

export type McapTier      = 'mega' | 'large' | 'mid' | 'small';
export type SignalFreshness = 'FRESH' | 'AGING' | 'STALE';
export type ExtensionRisk   = 'LOW' | 'MODERATE' | 'HIGH';
export type PullbackQuality = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
export type SectorMomentum  = 'ACCELERATING' | 'STABLE' | 'DECELERATING' | 'REVERSING';
export type SectorName =
  | 'BTC' | 'L1/L2' | 'DeFi' | 'AI' | 'Meme'
  | 'Gaming' | 'Infrastructure' | 'RWA' | 'Exchange'
  | 'Privacy' | 'Payments' | 'Other';

export interface SignalFreshnessData {
  status:           SignalFreshness;
  score:            number;   // 0-100
  ageMinutes:       number;
  lifecycleMinutes: number;
  decayPct:         number;   // 0-1, fraction of lifecycle elapsed
}

export interface EntryQualityResult {
  score:           number;         // 0-100, higher = better entry
  extensionRisk:   ExtensionRisk;
  pullbackQuality: PullbackQuality;
  lateEntry:       boolean;
  factors:         string[];
}

export interface SectorStats {
  name:            SectorName;
  coinCount:       number;
  gainers:         number;
  losers:          number;
  breadth:         number;   // 0-1, gainers/total
  avgChange24h:    number;
  momentum:        SectorMomentum;
  rank:            number;   // 1 = strongest
}

export interface ClusteringState {
  detected:         boolean;
  dominantSector?:  SectorName;
  concentration:    number;   // 0-1, fraction of signals from dominant sector
  warning?:         string;
}

// ─── Phase 6.1 — Tactical Intelligence types ─────────────────────────────────

export type SignalState =
  | 'DEVELOPING'    // aligned but borderline — building momentum
  | 'CONFIRMED'     // MTF aligned, healthy volume, healthy momentum
  | 'EXTENDED'      // momentum exhausted — entry late / risky
  | 'COOLING'       // momentum fading but trend intact
  | 'CORRECTING'    // MACD turned + RSI pulling back against direction
  | 'INVALIDATED'   // 1h trend has reversed against signal direction
  | 'EXPIRED';      // reserved for stored-signal re-evaluation (not produced at scan time)

export type MarketRegime =
  | 'BULL_TREND'      // BTC 4h bullish + trend strength ≥ 50
  | 'BEAR_TREND'      // BTC 4h bearish + trend strength ≥ 50
  | 'SIDEWAYS'        // no clear direction
  | 'HIGH_VOLATILITY' // ATR% > 5 + |24h change| > 5%
  | 'EUPHORIA'        // RSI > 78 + 24h > 8%
  | 'CAPITULATION';   // RSI < 22 + 24h < -8%

export type ExhaustionRisk = 'low' | 'medium' | 'high';
export type MomentumHealth = 'healthy' | 'fading' | 'exhausted';

export interface ContinuationAnalysis {
  continuationProbability: number;  // 0–100
  exhaustionRisk:          ExhaustionRisk;
  momentumHealth:          MomentumHealth;
  reasons:                 string[];
}

export interface MarketRegimeSnapshot {
  regime:      MarketRegime;
  btcRsi4h:    number;
  btcTrend4h:  'BULLISH' | 'BEARISH' | 'RANGING';
  btcAtrPct:   number;
  btc24hChange: number;
  computedAt:  Date;
}

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
  aiExplainability?: AIExplainability;
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
  // Phase 6.1 — tactical intelligence
  signalState?:            SignalState;
  institutionalScore?:     number;
  regimeAlignmentScore?:   number;
  marketRegime?:           MarketRegime;
  continuation?:           ContinuationAnalysis;
  // Phase 6.2 — adaptive quant intelligence
  mcapTier?:               McapTier;
  sectorName?:             SectorName;
  entryQualityScore?:      number;
  extensionRisk?:          ExtensionRisk;
  pullbackQuality?:        PullbackQuality;
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

export interface AIExplainability {
  trend:      string;  // multi-timeframe trend structure (1-2 sentences)
  momentum:   string;  // RSI / MACD / volume quality (1-2 sentences)
  volatility: string;  // ATR-based volatility and stop reliability (1 sentence)
  rationale:  string;  // why the confidence score is at this level (1 sentence)
  summary:    string;  // one-line human-readable trade thesis
  // Phase 6.1 additions
  continuationCase?: string;  // why continuation is likely
  cautionCase?:      string;  // main failure scenario
  regimeNote?:       string;  // how market regime affects this setup
}

export interface AIValidationResult {
  confidence:     number;
  validated:      boolean;
  reasoning:      string;
  risks:          string[];
  strengths:      string[];
  explainability?: AIExplainability;
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
  rejectionStats?: RejectionStats; // Phase 6.6
}

// ─── Phase 6.6 — Scanner Diagnostics & Rejection Intelligence ────────────────

export type RejectionStage =
  | 'candles'          // insufficient candle history
  | 'direction'        // 4h trend ranging — no direction
  | 'mtf'              // multi-timeframe conflict
  | 'volatility'       // extreme volatility gate
  | 'trend_strength'   // combined trend too weak
  | 'market_structure' // structural failure (overextension, S/R rejection, etc.)
  | 'setup_score'      // pre-AI scoring below threshold
  | 'rr_ratio'         // risk/reward below minimum
  | 'volume_tier'      // insufficient volume for market-cap tier
  | 'risk_engine'      // risk engine F grade
  | 'funding_rate'     // extreme futures funding rate
  | 'extension_risk'   // high extension risk for small-cap
  | 'continuation'     // continuation probability too low
  | 'ai_validation'    // Claude AI confidence below threshold

export interface RejectionEntry {
  symbol:     string
  stage:      RejectionStage
  reason:     string
  metrics:    Record<string, number | string>
  threshold?: number
  actual?:    number
  isNearMiss: boolean
  scanRunId?: string
  ts:         number
}

export interface RejectionStats {
  totalScanned:  number
  totalAccepted: number
  totalRejected: number
  byStage:       Partial<Record<RejectionStage, number>>
  nearMisses:    RejectionEntry[]
  topReasons:    Array<{ stage: RejectionStage; count: number; pct: number }>
  scanRunId?:    string
  scannedAt:     number
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

// ─── Signal Performance Analytics ───────────────────────────────────────────

export type SignalOutcome = 'PENDING' | 'TP_HIT' | 'SL_HIT' | 'TIMEOUT';
export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';

export interface SignalOutcomeRecord {
  id: string;
  signalId: string;
  symbol: string;
  signalType: SignalType;
  timeframe: Timeframe;
  scannerMode: ScannerMode;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  rrRatio: number;
  confidence: number;
  aiValidated: boolean;
  volatilityRegime: VolatilityRegime;
  riskGrade?: RiskGrade;
  riskScore?: number;
  qualityScore?: number;
  outcome: SignalOutcome;
  exitPrice?: number;
  exitTime?: Date;
  rrAchieved?: number;
  pnlPct?: number;
  durationHours?: number;
  createdAt: Date;
  resolvedAt?: Date;
  checkedAt?: Date;
  checkCount: number;
}

export interface PerformanceMetrics {
  totalSignals: number;
  resolvedSignals: number;
  pendingSignals: number;
  tpHitRate: number;
  slHitRate: number;
  timeoutRate: number;
  winRate: number;
  avgRRAchieved: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  totalReturn: number;
  sharpeRatio: number;
  avgConfidence: number;
  aiValidatedWinRate: number;
  nonAiWinRate: number;
}

export interface BreakdownMetrics {
  key: string;
  label: string;
  totalSignals: number;
  resolvedSignals: number;
  winRate: number;
  avgRR: number;
  expectancy: number;
  profitFactor: number;
  tpHitRate: number;
  avgConfidence: number;
}

export interface SetupPattern {
  symbol: string;
  timeframe: Timeframe;
  scannerMode: ScannerMode;
  signalType: SignalType;
  totalTrades: number;
  winRate: number;
  avgRR: number;
  expectancy: number;
  profitFactor: number;
  avgConfidence: number;
  lastSignalAt?: Date;
}

export interface AIAccuracyBucket {
  band: string;
  minConfidence: number;
  maxConfidence: number;
  total: number;
  winRate: number;
  avgRRAchieved: number;
  tpHitRate: number;
}

export interface AnalyticsData {
  overall: PerformanceMetrics;
  byCoin: BreakdownMetrics[];
  byTimeframe: BreakdownMetrics[];
  byMode: BreakdownMetrics[];
  byVolatility: BreakdownMetrics[];
  bestSetups: SetupPattern[];
  worstSetups: SetupPattern[];
  aiAccuracy: AIAccuracyBucket[];
  resolutionStatus: {
    total: number;
    resolved: number;
    pending: number;
    resolvedToday: number;
  };
  lastUpdated: Date;
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

// ─── Paper Trading ───────────────────────────────────────────────────────────

export type PaperTradeStatus     = 'OPEN' | 'CLOSED_TP' | 'CLOSED_SL' | 'CLOSED_MANUAL' | 'CLOSED_EXPIRED';
export type PaperTradeExitReason = 'TP_HIT' | 'SL_HIT' | 'MANUAL' | 'EXPIRED';

export interface PaperPortfolio {
  id:               string;
  name:             string;
  initialCapital:   number;
  availableCapital: number;   // cash not locked in positions
  realizedPnl:      number;   // cumulative closed-trade PnL in USDT
  totalTrades:      number;
  wins:             number;
  losses:           number;
  createdAt:        Date;
  updatedAt:        Date;
}

export interface PaperTrade {
  id:             string;
  portfolioId:    string;
  signalId?:      string;
  symbol:         string;
  signalType:     'BUY' | 'SELL';
  timeframe:      Timeframe;
  scannerMode:    ScannerMode;
  confidence:     number;
  entryPrice:     number;
  targetPrice:    number;
  stopLoss:       number;
  rrRatio:        number;
  leverage:       number;
  riskPct:        number;          // fraction of portfolio equity risked (0.01 = 1%)
  notionalUsdt:   number;          // position face value
  marginUsdt:     number;          // capital locked = notionalUsdt / leverage
  riskAmountUsdt: number;          // max loss in USDT
  quantity:       number;
  status:         PaperTradeStatus;
  exitPrice?:     number;
  exitReason?:    PaperTradeExitReason;
  realizedPnl?:   number;
  realizedPnlPct?: number;
  durationHours?: number;
  createdAt:      Date;
  closedAt?:      Date;
  lastCheckedAt?: Date;
}

export interface OpenTradeView extends PaperTrade {
  currentPrice:    number;
  unrealizedPnl:   number;
  unrealizedPnlPct: number;
  progressPct:     number;   // 0–100: 0 = at SL, 100 = at TP
  distanceToTpPct: number;   // % from current to target
  distanceToSlPct: number;   // % from current to stop-loss
}

export interface PortfolioMetrics {
  totalTrades:    number;
  openTrades:     number;
  winRate:        number;
  avgRR:          number;
  totalReturnPct: number;
  profitFactor:   number;
  bestTrade:      number;
  worstTrade:     number;
}

export interface PortfolioSnapshot {
  portfolio:     PaperPortfolio;
  totalEquity:   number;           // availableCapital + marginLocked + unrealizedPnl
  unrealizedPnl: number;
  marginLocked:  number;
  openTrades:    OpenTradeView[];
  recentTrades:  PaperTrade[];
  metrics:       PortfolioMetrics;
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

// ─── Phase 6.7 — Quant Outcome Attribution ───────────────────────────────────

/** Flattened JOIN of signal_outcomes + signals tactical fields */
export interface AttributionRow {
  signalId:                string
  symbol:                  string
  signalType:              SignalType
  timeframe:               Timeframe
  scannerMode:             ScannerMode
  confidence:              number
  aiValidated:             boolean
  riskGrade?:              RiskGrade
  rrRatio:                 number
  outcome:                 'TP_HIT' | 'SL_HIT' | 'TIMEOUT'
  rrAchieved?:             number
  pnlPct?:                 number
  durationHours?:          number
  createdAt:               Date
  resolvedAt?:             Date
  // Phase 6.7 tactical fields — null for pre-6.7 signals
  marketRegime?:           MarketRegime
  institutionalScore?:     number
  signalState?:            SignalState
  extensionRisk?:          ExtensionRisk
  mcapTier?:               McapTier
  sectorName?:             SectorName
  continuationProbability?: number
  regimeAlignmentScore?:   number
}

/** Per-dimension win/loss statistics */
export interface AttributionDimension {
  key:           string
  label:         string
  total:         number
  winRate:       number | null
  avgRRAchieved: number | null
  expectancy:    number | null
  tpHitRate:     number | null
  avgConfidence: number
}

/** High-expectancy (regime, signalState) combination */
export interface EdgePattern {
  dimensions:    Record<string, string>
  label:         string
  total:         number
  winRate:       number
  avgRRAchieved: number | null
  expectancy:    number
  rank:          number
}

/** Data-driven calibration recommendation */
export interface ThresholdRecommendation {
  parameter:  string
  insight:    string
  direction:  'RAISE' | 'LOWER' | 'MONITOR'
  impact:     'HIGH' | 'MEDIUM' | 'LOW'
  basis:      string
}

/** Full attribution report returned by /api/analytics/attribution */
export interface AttributionReport {
  generatedAt:  Date
  windowHours:  number
  totalRows:    number
  resolvedRows: number
  /** True if most rows lack tactical fields (pre-Phase 6.7 data) */
  dataGap:      boolean
  /** True if fewer than 20 resolved rows — not enough for meaningful stats */
  insufficient: boolean
  dimensions: {
    byRegime:        AttributionDimension[]
    byMcapTier:      AttributionDimension[]
    bySignalState:   AttributionDimension[]
    byExtensionRisk: AttributionDimension[]
    bySector:        AttributionDimension[]
    byAiValidated:   AttributionDimension[]
    byTimeframe:     AttributionDimension[]
    byScannerMode:   AttributionDimension[]
  }
  edgePatterns:    EdgePattern[]
  recommendations: ThresholdRecommendation[]
  aiEffectiveness: {
    aiApproved:  { total: number; winRate: number | null; expectancy: number | null }
    heuristic:   { total: number; winRate: number | null; expectancy: number | null }
    aiEdgeDelta: number | null
  }
}
