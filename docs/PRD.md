# Product Requirements Document — SignalEdge AI

**Version:** 1.2  
**Status:** Live  
**Last updated:** 2026-05-30

---

## 1. Overview

### Vision

A fully automated, AI-validated crypto trading signal scanner that monitors the top 200 cryptocurrencies (via CoinMarketCap) around the clock, surfaces high-probability trade setups with institutional-grade intelligence, and delivers actionable alerts to traders — without requiring manual chart analysis.

### Problem Statement

Retail traders cannot watch 100+ markets simultaneously. Manual scanning is slow, biased, and inconsistent. Existing scanners produce noisy signals with no quality ranking or risk context. This system solves that by:

1. Running continuous multi-timeframe technical analysis across the top 200 coins (CMC primary)
2. Applying an 11-gate quality pipeline that rejects weak setups before any expensive AI call
3. Fusing 5-source trending discovery (CMC Trending, Rising Sectors, Top Movers, Listings, Watchlist)
4. Classifying global market regime from BTC 4h candles and CMC sector intelligence
5. Computing continuation probability, signal lifecycle state, and breakout momentum for every setup
6. Enriching futures signals with institutional-grade intelligence (directional funding, OI×price matrix, L/S positioning)
7. Scoring every surviving signal with a risk grade, quality score, trend score (for TRENDING mode), and institutional composite score
8. Validating the final signal with Claude Haiku (8-field explainability) and delivering it via Telegram

---

## 2. Users

**Primary:** Individual crypto traders who want signal ideas but lack time for manual scanning.

**Secondary:** Algorithmic traders using the API to feed signals into their own execution systems.

---

## 3. Functional Requirements

### 3.1 Market Scanner

| ID | Requirement | Priority |
|----|-------------|----------|
| SC-01 | Scan top-200 coins by market cap from CoinMarketCap (primary) via Redis intelligence cache | Must |
| SC-02 | Support four modes: `spot`, `futures`, `high_confidence`, `trending` | Must |
| SC-03 | Fetch 1h/4h (300 candles each) and 1d (100 candles) from Binance for each coin | Must |
| SC-04 | Calculate RSI(14), MACD, EMA20/50/200, ATR(14), volume spike, ADX, bollinger bands, patterns | Must |
| SC-05 | Multi-timeframe confirmation: 4h sets direction, 1h confirms entry, 1d trend context | Must |
| SC-06 | Reject signals when 1h/4h trends conflict or both sideways (ADX < 16) | Must |
| SC-07 | Volatility gate: reject EXTREME volatility (ATR > 8% of price) | Must |
| SC-08 | Pre-AI setup scoring: 0–100 scale, threshold 60 to proceed; AI only if ≥72 | Must |
| SC-09 | ATR-based trade levels (entry, target, stop-loss) with 20/30-day breakout scoring | Must |
| SC-10 | Enforce minimum R:R ratio of 2.0 before AI call | Must |
| SC-11 | Rate-limit scan triggers: max 20/hour, min 2-min gap | Must |
| SC-12 | Persist scan run metadata (mode, duration, signals found, rejection breakdown) | Must |

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

### 3.4 Futures Intelligence (Phase 7.3A & 7.4A)

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FI-01 | Fetch live directional funding rate per symbol (Binance premium index) | Must | ✅ 7.3A |
| FI-02 | Directional funding context: FAVORABLE/NORMAL/ELEVATED/EXTREME (adverse_rate thresholds) | Must | ✅ 7.3A |
| FI-03 | Fetch open-interest history (24h) and classify as RISING / FALLING / STABLE | Must | ✅ 7.4A.2 |
| FI-04 | OI × price direction intelligence: NEW_LONGS / NEW_SHORTS / SHORT_COVERING / LONG_LIQUIDATION / NEUTRAL | Must | ✅ 7.4A.2 |
| FI-05 | Funding rate trend (last 3 readings): RISING/FALLING/STABLE classification with multiplier adjustment | Must | ✅ 7.4A.4 |
| FI-06 | Detect liquidation zones from swing highs/lows and ATR levels | Must | ✅ 7.3A |
| FI-07 | L/S positioning context: EXTREME_LONG/LONG_HEAVY/BALANCED/SHORT_HEAVY/EXTREME_SHORT (contrarian scoring) | Must | ✅ 7.4A.5 |
| FI-08 | Compute momentum score (0–100) with BTC/ETH/SOL priority bonus (+5) | Must | ✅ 7.3A |
| FI-09 | Cache funding (5 min), OI (2 min), L/S ratio (5 min), funding trend (8h) per symbol | Must | ✅ 7.4A.4 |
| FI-10 | Non-fatal: proceed without futures data if Binance API unavailable | Must | ✅ 7.3A |
| FI-11 | Breakout detection (20/30-day high/low with BB expansion) for ALL modes including SPOT | Must | ✅ 7.4A.1 |
| FI-12 | 4h EMA200 convergence guard (direction_reliable ≥ 250c, bounce_reliable ≥ 280c) | Must | ✅ 7.4A.3 |

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
- **Admin routes** (`/admin/*`, `/api/admin/*`) protected by Supabase Auth + email allowlist
- **Python backend** protected by `X-Admin-Secret` shared header — rejects direct callers
- **Settings writes** guarded by two-tier safety layer (hard caps + semantic rules) + atomic DB transaction
- **Auth events** (login, logout, failures, unauthorized access) logged to `admin_auth_log` table

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

## 6. Admin Configuration System (Phase 5)

### 6.1 Settings Groups

Nine strongly-typed Pydantic v2 group models stored in `settings_groups` (PostgreSQL):

| Group | Key controls |
|-------|-------------|
| `scanner` | Scan interval, max coins, confidence threshold, mode |
| `signals` | Min RR ratio, max SL %, min quality score |
| `ai` | Model, temperature, max tokens, timeout |
| `telegram` | Bot enabled, alert threshold, daily summary time |
| `risk` | Leverage caps (conservative/standard/aggressive), portfolio risk %, quality filters |
| `paper_trading` | Position size, max open trades, virtual balance |
| `anomaly` | Win-rate drop / drawdown / queue-depth critical thresholds |
| `features` | Feature flag toggles (paper trading, AI validation, futures, Telegram) |
| `infra` | Scan concurrency, DB pool size, cache TTLs, scanner timeout |

### 6.2 Safety Layer (`backend/system_settings/safety.py`)

Two tiers run before every `patch_group()` write:

- **Tier 1 — SAFETY_CAPS**: absolute per-field min/max. Changing Pydantic Field bounds cannot loosen these. All violations are errors (block save).
- **Tier 2 — Semantic rules**: cross-field combination checks (e.g. catastrophic leverage + large position size). Errors block save; warnings are returned to the UI for display.

### 6.3 Config Propagation

Changes reach all processes within ≤ 5 seconds:

1. `patch_group()` INCrements `settings:generation` in Redis and publishes to `settings_changed` channel.
2. `PropagationListener` (async, FastAPI) receives pub/sub messages and calls `apply_group_to_modules()`.
3. `CeleryConfigWatcher` (sync daemon thread) polls the generation counter every 5 s.
4. All readers check the generation counter on every cache miss.

### 6.4 Experiments

Layered on top of base settings — active experiments are resolved per-request:
- Context filter (subset match against caller context)
- Rollout % probabilistic gate
- Expiry check
- Dry-run mode: logs would-apply overrides without applying

### 6.5 Audit

Every settings change is recorded in `settings_group_audit` with field-level diffs, old/new version, and `updated_by`.

---

## 7. Data Model Summary

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

### `settings_groups`

Key fields: `group_name` (PK), `schema_version`, `data_version`, `data` (JSONB), `updated_by`, `updated_at`

### `settings_group_audit`

Key fields: `id`, `group_name`, `old_version`, `new_version`, `changed_fields` (JSONB), `schema_version`, `updated_by`, `updated_at`

### `settings_experiments`

Key fields: `id`, `name`, `group_name`, `overrides` (JSONB), `status` (draft/active/paused/concluded), `rollout_pct`, `context_filter` (JSONB), `dry_run`, `expires_at`, `created_by`

### `admin_auth_log`

Key fields: `id`, `event` (login/logout/login_failed/unauthorized), `email`, `ip`, `user_agent`, `detail`, `created_at`

---

## 8. Out of Scope (v1)

- Order execution / live trading (read-only signal scanner)
- WebSocket streaming (polling-based, 30s signals / 5s scheduler)
- Multi-user authentication and per-user signal feeds
- Mobile application
- Options / derivatives beyond linear futures
- Distributed rate limiting (Redis) — single-instance only in v1
- Test suite (unit, integration, E2E)
- Prometheus/Grafana metrics endpoint

---

## 9. Roadmap

| Phase | Status | Items |
|-------|--------|-------|
| v1.0 | ✅ Done | Scanner, risk engine, AI validation, Telegram, dashboard, backtest |
| v1.1 | ✅ Done | Redis-backed settings propagation, config system, anomaly detection burn-in |
| v1.2 | ✅ Done | Admin settings UI — grouped, inline validation, auto-save, audit log, feature flags |
| v1.2.1 | ✅ Done | Settings safety layer — hard caps, semantic rules, atomic transactions |
| v1.2.2 | ✅ Done | Experimental configuration — staged rollouts, dry-run, context filtering |
| Phase 5.1 | ✅ Done | Admin auth + deployment hardening — Supabase Auth, email allowlist, backend secret, audit log |
| Phase 5.5 | ✅ Done | Dashboard polish — opportunity summary, signal strengths, mover ranks, institutional UX |
| Phase A | ✅ Done | Public SaaS website — landing page, /pricing, /investors, /about (SignalEdge AI brand) |
| Phase 6.1 | ✅ Done | Tactical Intelligence Engine — market regime, signal lifecycle states, institutional score, continuation probability, 10 false-positive filters, 8-field AI explainability |
| v1.4 | Planned | Prometheus metrics endpoint + Grafana dashboard |
| v1.5 | Planned | Full test suite (Vitest unit + Playwright E2E) |
| v2.0 | Planned | Multi-user authentication + per-user watchlists and signal feeds |
