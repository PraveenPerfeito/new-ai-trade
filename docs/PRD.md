# Product Requirements Document — Crypto Market Scanner

**Version:** 1.0  
**Status:** Live  
**Last updated:** 2026-05-18

---

## 1. Overview

### Vision

A fully automated, AI-validated crypto trading signal scanner that monitors the top 100 cryptocurrencies around the clock, surfaces high-probability trade setups, and delivers actionable alerts to traders — without requiring manual chart analysis.

### Problem Statement

Retail traders cannot watch 100 markets simultaneously. Manual scanning is slow, biased, and inconsistent. Existing scanners produce noisy signals with no quality ranking or risk context. This system solves that by:

1. Running continuous multi-timeframe technical analysis across the top 100 coins
2. Applying a 10-step quality pipeline that rejects weak setups before any expensive AI call
3. Enriching futures signals with market-structure data (funding rates, OI, liquidation zones)
4. Scoring every surviving signal with a risk grade and quality score
5. Validating the final signal with Claude Haiku and delivering it via Telegram

---

## 2. Users

**Primary:** Individual crypto traders who want signal ideas but lack time for manual scanning.

**Secondary:** Algorithmic traders using the API to feed signals into their own execution systems.

---

## 3. Functional Requirements

### 3.1 Market Scanner

| ID | Requirement | Priority |
|----|-------------|----------|
| SC-01 | Scan top-100 coins by market cap from CoinGecko | Must |
| SC-02 | Support four modes: `spot`, `futures`, `high_confidence`, `trending` | Must |
| SC-03 | Fetch 1h and 4h candles from Binance for each coin | Must |
| SC-04 | Calculate RSI(14), MACD, EMA20, EMA50, ATR(14), volume spike | Must |
| SC-05 | Multi-timeframe confirmation: 4h sets direction, 1h confirms entry | Must |
| SC-06 | Reject signals when 1h/4h trends conflict | Must |
| SC-07 | Volatility gate: reject EXTREME volatility (ATR > 8% of price) | Must |
| SC-08 | Pre-AI setup scoring: 0–100 scale, threshold 65 to proceed | Must |
| SC-09 | ATR-based trade levels (entry, target, stop-loss) | Must |
| SC-10 | Enforce minimum R:R ratio of 2.0 before AI call | Must |
| SC-11 | Rate-limit scan triggers: max 20/hour, min 2-min gap | Must |
| SC-12 | Persist scan run metadata (mode, duration, signals found) | Must |

### 3.2 Risk Engine

| ID | Requirement | Priority |
|----|-------------|----------|
| RE-01 | Calculate risk score (0–100, lower = safer) and quality score (0–100, higher = better) | Must |
| RE-02 | Assign risk grade: A / B / C / D / F | Must |
| RE-03 | Reject signals with CRITICAL violations or risk score > 60 | Must |
| RE-04 | Validate R:R ratio (min 2.0), stop-loss distance, volatility, overextension, liquidity | Must |
| RE-05 | Calculate max safe leverage (snap to tiers: 1×, 2×, 3×, 5×, 10×, 15×, 20×) | Must |
| RE-06 | Calculate position-size multiplier per grade (A=1.0, B=0.75, C=0.5, D=0.35, F=0) | Must |
| RE-07 | Run risk engine BEFORE AI call to reduce Claude API spend | Must |

### 3.3 AI Signal Validation

| ID | Requirement | Priority |
|----|-------------|----------|
| AI-01 | Validate every surviving signal with Claude Haiku | Must |
| AI-02 | Prompt includes 1h and 4h indicators, trade levels, quality metrics, futures data | Must |
| AI-03 | Claude returns: confidence (0–100), validated (bool), reasoning, risks, strengths | Must |
| AI-04 | Signal rejected if confidence < mode's minimum threshold | Must |
| AI-05 | Heuristic fallback scorer if API key absent or API error | Must |

### 3.4 Futures Intelligence

| ID | Requirement | Priority |
|----|-------------|----------|
| FI-01 | Fetch live funding rate per symbol (Binance premium index) | Must |
| FI-02 | Reject signals when |funding rate| > 0.2% (extreme crowding) | Must |
| FI-03 | Fetch open-interest history (24h) and classify as RISING / FALLING / STABLE | Must |
| FI-04 | Fetch global long/short account ratio | Must |
| FI-05 | Detect liquidation zones from swing highs/lows and ATR levels | Must |
| FI-06 | Detect 20-candle consolidation breakouts with volume confirmation | Must |
| FI-07 | Analyse trend-continuation pullbacks via EMA20 proximity | Must |
| FI-08 | Compute momentum score (0–100) with BTC/ETH/SOL priority bonus (+5) | Must |
| FI-09 | Cache funding (5 min), OI (2 min), L/S ratio (5 min) per symbol | Must |
| FI-10 | Non-fatal: proceed without futures data if Binance API unavailable | Must |

### 3.5 Auto-Scheduler

| ID | Requirement | Priority |
|----|-------------|----------|
| AS-01 | Configurable scan interval (default: 5 min) | Must |
| AS-02 | Distributed lock prevents overlapping scans | Must |
| AS-03 | Exponential backoff retry on failure (30s → 60s → 120s) | Must |
| AS-04 | Auto-pause after 3 consecutive failures (10 min cooldown) | Must |
| AS-05 | Queue at most one pending scan while another runs | Must |
| AS-06 | Survive Next.js hot-module replacement via `globalThis` singleton | Must |

### 3.6 Backtesting Engine

| ID | Requirement | Priority |
|----|-------------|----------|
| BT-01 | Replay 1h historical candles for 7–90 day lookback windows | Must |
| BT-02 | Use identical pipeline logic as live scanner (same `detectSetup`, `tradeLevels`) | Must |
| BT-03 | Synthetic 4h candles aggregated from four 1h candles | Must |
| BT-04 | Forward-walk simulation: walk candles to find TP or SL hit | Must |
| BT-05 | Timeout outcome when trade exceeds `maxHoldCandles` | Must |
| BT-06 | Metrics: win rate, loss rate, timeout rate, profit factor, max drawdown, Sharpe ratio, avg RR, equity curve | Must |
| BT-07 | Store results in Supabase (`backtest_runs`, `backtest_trades`) | Must |
| BT-08 | Strategy comparison API with composite score: `winRate×30 + min(PF,5)×10 + Sharpe×20 − DD×10` | Should |
| BT-09 | Equity curve SVG chart rendered client-side (no charting library) | Should |

### 3.7 Notifications

| ID | Requirement | Priority |
|----|-------------|----------|
| NT-01 | Send formatted Telegram alert for signals ≥ `SCANNER_MIN_CONFIDENCE_ALERT` | Must |
| NT-02 | Alert includes: symbol, direction, entry/TP/SL/RR, confidence, risk grade, funding rate, AI reasoning | Must |
| NT-03 | Daily summary message (total scans, signals, best signal) | Should |

### 3.8 Dashboard

| ID | Requirement | Priority |
|----|-------------|----------|
| DB-01 | Real-time signal feed with confidence bar, risk grade badge, futures badges | Must |
| DB-02 | Live price ticker scrolling top-20 coins | Must |
| DB-03 | Stats bar: total scanned, signals, high-confidence count, last scan time | Must |
| DB-04 | Top-movers and market-widget panels | Must |
| DB-05 | Manual scan trigger with mode selector | Must |
| DB-06 | Auto-scan toggle with live scanning indicator | Must |
| DB-07 | Backtest panel: run, view results, compare strategies, view trades | Must |
| DB-08 | Tab navigation: Scanner / Backtest | Must |
| DB-09 | UTC clock in header | Nice |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| Metric | Target |
|--------|--------|
| Scan time (50 coins, futures mode) | < 90 seconds |
| Signal API response time | < 500 ms (P99) |
| Dashboard initial load | < 3 seconds |
| Health check response | < 2 seconds |

### 4.2 Reliability

| Metric | Target |
|--------|--------|
| Uptime | 99.5% |
| External API failure handling | Retry with 3× exponential backoff |
| Scan failure recovery | Auto-retry with 30s/60s/120s backoff |
| DB write failure | Log and continue (non-fatal) |

### 4.3 Security

- All API routes protected by per-IP rate limiting (100 req / 60s, configurable)
- Security headers on every response: HSTS, CSP, X-Frame-Options, X-Content-Type-Options
- Sensitive fields redacted from logs (`authorization`, `cookie`, `apiKey`)
- `SUPABASE_SERVICE_ROLE_KEY` never exposed to the browser
- No hardcoded credentials anywhere in the codebase
- `ALLOWED_ORIGINS` CORS allow-list for production

### 4.4 Observability

- Structured JSON logs (pino) with module, request ID, and timing on every log line
- `GET /api/health` reports Supabase latency, Anthropic config, Telegram config, CoinGecko config
- Every scan run persisted with status, duration, error message on failure

### 4.5 Scalability

- Stateless Next.js server — horizontal scaling ready
- In-memory rate limiter and scheduler reset on cold start (acceptable for single-instance; swap in Redis for multi-instance)
- Standalone Docker output: no full Node.js server weight, minimal image size

---

## 5. Integration Specifications

### Binance REST API

| Endpoint | Usage | TTL |
|----------|-------|-----|
| `GET /api/v3/klines` | Spot OHLCV candles | Per-request |
| `GET /fapi/v1/klines` | Futures OHLCV candles | Per-request |
| `GET /fapi/v1/exchangeInfo` | Futures symbol list | 30 min |
| `GET /fapi/v1/premiumIndex` | Funding rate | 5 min |
| `GET /futures/data/openInterestHist` | OI history | 2 min |
| `GET /futures/data/globalLongShortAccountRatio` | L/S ratio | 5 min |

All Binance calls wrapped with `withApiRetry` (3×, 600ms base, 8s max).

### CoinGecko API

| Endpoint | Usage | TTL |
|----------|-------|-----|
| `GET /coins/markets` | Top-100 coins by market cap | Per scan |

Two paginated requests (50 coins × 2 pages) with 400ms stagger. Wrapped with `withApiRetry`.

### Anthropic (Claude Haiku 4.5)

- Called once per coin that passes all pre-AI gates
- Max tokens: 512 (JSON response only)
- Prompt includes full 1h/4h indicator context + futures data
- Heuristic fallback: no API cost, mirrors Claude's rejection criteria

### Supabase (PostgreSQL)

- Service-role key used server-side for writes (bypasses RLS)
- Anon key used for health check probe (read-only)
- Bulk inserts (200-row chunks) for backtest trades

### Telegram Bot API

- `sendMessage` with HTML parse mode
- Non-fatal: scanner continues if Telegram is unavailable
- Confidence emoji and risk-grade indicator in message

---

## 6. Data Model Summary

### `signals`

Key fields: `symbol`, `type` (BUY/SELL), `timeframe`, `scanner_mode`, `entry_price`, `target_price`, `stop_loss`, `rr_ratio`, `confidence`, `risk_score`, `quality_score`, `risk_grade`, `ai_validated`, `ai_reasoning`, `futures_data` (JSONB), `created_at`

### `scan_runs`

Key fields: `id`, `mode`, `started_at`, `completed_at`, `coins_scanned`, `signals_found`, `status`, `error`

### `coins`

Key fields: `id`, `symbol`, `name`, `rank`, `price`, `market_cap`, `volume_24h`, `price_change_24h`, `binance_symbol`, `updated_at`

### `backtest_runs`

Key fields: `id`, `strategy_name`, `mode`, `coins_tested`, `total_trades`, `status`, `win_rate`, `profit_factor`, `max_drawdown`, `sharpe_ratio`, `equity_curve` (JSONB), `config` (JSONB)

### `backtest_trades`

Key fields: `id`, `backtest_run_id` (FK), `symbol`, `type`, `entry_price`, `exit_price`, `outcome` (WIN/LOSS/TIMEOUT), `pnl_pct`, `rr_ratio`, `duration_candles`, `exit_reason`

---

## 7. Out of Scope (v1)

- Order execution / live trading (read-only signal scanner)
- WebSocket streaming (polling-based, 30s signals / 5s scheduler)
- Multi-user authentication and per-user signal feeds
- Mobile application
- Options / derivatives beyond linear futures
- Distributed rate limiting (Redis) — single-instance only in v1
- Test suite (unit, integration, E2E)
- Prometheus/Grafana metrics endpoint

---

## 8. Roadmap

| Phase | Items |
|-------|-------|
| v1.1 | Redis-backed rate limiting + distributed scheduler lock |
| v1.2 | WebSocket / Server-Sent Events for real-time signal push |
| v1.3 | User authentication (Supabase Auth) + per-user watchlists |
| v1.4 | Prometheus metrics endpoint + Grafana dashboard |
| v1.5 | Full test suite (Vitest unit + Playwright E2E) |
| v2.0 | Paper-trading execution layer with P&L tracking |
