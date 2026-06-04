# SignalEdge AI

AI-powered cryptocurrency trading signal scanner. Scans a cached large-cap and mid-cap universe, applies an 11-gate quality pipeline with advanced technical analysis, and surfaces high-probability setups via a glassmorphism admin dashboard and Telegram alerts.

**Stack:** Next.js 14 Â· TypeScript Â· FastAPI (Python 3.12) Â· Supabase Â· Upstash Redis Â· Claude Haiku Â· Binance API Â· CoinMarketCap Â· Railway

---

## Current Runtime Notes (2026-06-03)

- Scanner signals use closed Binance candles only. The currently open spot/futures candle is dropped before indicators and setup scoring run.
- Duplicate same-direction 1h signals are suppressed before DB save, Telegram send, and outcome registration.
- CMC-derived signal influence is currently disabled in the Python scanner until `trend_score` and `sector_status` attribution is measurable again in resolved outcomes. The live scanner falls back to CoinGecko listings for its runtime universe.
- Pure `bb_expansion` is not accepted as a standalone breakout path. BB context only boosts a structural breakout.
- A narrow denylist now rejects proven toxic `breakout_type=NULL` setup templates, while surviving NULL setups receive confidence penalties instead of a blanket family removal.

---

## Features

### Signal Pipeline (11 Gates)

1. **Multi-timeframe confirmation** â€” 1h + 4h + 1d candles must align
2. **Volatility gate** â€” ATR-based filter rejects extreme volatility
3. **Trend strength** â€” EMA/MACD composite score (0â€“100)
4. **Market structure** â€” 7 false-positive filters (doji, engulfing, fake breakout, wash trade, RSI divergence, overextension, S/R rejection)
5. **Setup scoring** â€” multi-factor quality score including:
   - EMA200 bounce detection (+15 pts, 4h/1h convergence guard with â‰¥250 candles)
   - Bollinger Band squeeze detection (+15 pts); pure BB expansion is not treated as a standalone breakout
   - Daily timeframe alignment (+12 pts)
   - 10 candlestick patterns: Hammer, Shooting Star, Morning/Evening Star, Three White Soldiers/Black Crows, Marubozu, Inverted Hammer, Hanging Man
   - Fresh EMA crossover (Golden/Death Cross within 5 candles) (+12 pts)
   - Relative strength vs BTC 4h (+10 pts)
   - Toxic non-breakout templates are hard-rejected; surviving `breakout_type=NULL` setups are penalized by direction, mode, volatility, and context
   - Breakout intelligence â€” 20/30-day high/low detection with BB expansion, EARLY_BREAKOUT/CONFIRMED/HIGH_MOMENTUM scoring (+5 to +12 pts)
6. **R:R ratio** â€” minimum 2:1 reward-to-risk
7. **Risk engine** â€” grade Aâ€“F, quality score, safe leverage tiers
8. **Futures intelligence** â€” directional funding rate with FAVORABLE/NORMAL/ELEVATED/EXTREME tiers, OI intelligence (NEW_LONGS/NEW_SHORTS/SHORT_COVERING/LONG_LIQUIDATION/NEUTRAL matrix), L/S positioning (EXTREME_LONG/LONG_HEAVY/BALANCED/SHORT_HEAVY/EXTREME_SHORT with contrarian scoring), funding trend (RISING/FALLING/STABLE with trend multiplier), liquidation zones (futures/high_confidence modes)
9. **Continuation gate** â€” probability score (10â€“95), rejects low-momentum setups
10. **Signal lifecycle** â€” DEVELOPING/CONFIRMED/EXTENDED/COOLING/CORRECTING/INVALIDATED/EXPIRED
11. **Claude AI validation** â€” Haiku validates final signal with full context (can be disabled from dashboard to conserve credits)

### Indicators (Pure Python â€” TradingView-matched)

- RSI(14) â€” Wilder EWM smoothing
- MACD â€” EMA(12) âˆ’ EMA(26), signal EMA(9)
- EMA 20 / 50 / 200 (with convergence guards at â‰¥250 candles)
- ATR(14) â€” Wilder True Range
- Volume Spike â€” current vs 20-candle rolling avg (time-weighted)
- ADX â€” Wilder DI+/DI- (sideways market detection)
- Bollinger Bands (20, 2Ïƒ) â€” with squeeze & expansion detection
- Trend Strength Score (0â€“100 composite)
- EMA Crossover Freshness (within 5 candles)
- Candlestick Pattern Detection (10 patterns, TradingView-validated body ratios)
- Relative Strength Engine (4h coin change / 4h BTC change)
- Sector Intelligence (STRONGEST/ACCELERATING/NEUTRAL/WEAKENING/OVERCROWDED states)
- Breakout Detection (20/30-day high/low with volume confirmation)
- OI Intelligence (NEW_LONGS/NEW_SHORTS/SHORT_COVERING/LONG_LIQUIDATION/NEUTRAL matrix)

### Scan Modes

| Mode | Min MCap | Min Volume | Min Confidence | Max Coins |
|------|----------|------------|----------------|-----------|
| `spot` | $200M | $20M | 80% | 80 |
| `futures` | $1B | $200M | 82% | 50 |
| `high_confidence` | $2B | $500M | 87% | 30 |
| `trending` | $50M | $10M | 78% | 80 |

### Admin Command Center (Phase 7.2B UX Redesign)

| Page | Path | Description |
|------|------|-------------|
| Command Overview | `/admin/overview` | Scanner status, regime card, signal metrics, recent signals, live next-scan countdown |
| Market Intelligence | `/admin/market` | Hero regime card, compact breadth bar, 6 trending coins |
| Scanner Control | `/admin/scanner` | Start/stop/pause/resume/e-stop Â· mode & interval Â· rejection diagnostics |
| Signals (Intelligence Visibility) | `/admin/signals` | Live signal feed with **Intelligence section** (TrendScore, Sector, Breakout, OI, Funding, Positioning) |
| Tactical Feed | `/admin/tactical` | Signal lifecycle â€” colored accent bars per stage, preset filter buttons, responsive cards |
| Sector Rotation | `/admin/sectors` | Category cards with STRONGEST/ACCELERATING/WEAKENING/OVERCROWDED badges |
| Regime Intelligence | `/admin/regime` | RSI gauge, trading implication, **Apply Regime Settings button**, preview modal |
| Calibration | `/admin/calibration` | **Claude AI on/off toggle** Â· verdict distribution Â· confidence bands (3 sections) |
| Edge Analytics | `/admin/analytics` | Win rate, expectancy, profit factor, Sharpe â€” overflow-x-auto, secondary columns hidden mobile |
| Founder Control Center | `/admin/settings` | 3 primary modes (Conservative/Balanced/Aggressive), Advanced Presets, 4 key controls, Active Settings Summary |
| Operations Dashboard | `/admin/providers` | ProviderStatusBoard (CMC/Binance/CoinGecko), QuotaBurnForecast, CompactProviderCard (collapsed ~56px) |
| Cache & System Operations | `/admin/cache` Â· `/admin/system` | Hit-rate progress bars, fresh/stale count, compact workers; larger status banner |
| Anomaly Action Center | `/admin/anomalies` | 4 action buttons (Acknowledge/Mute/Resolve/Detail), state machine, 4-tile Active Issues summary |
| (Sidebar restructured) | â€” | TRADING DESK / MARKET / OPERATIONS / REVIEW groups, "SignalEdge" brand |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) Â· TypeScript 5 Â· React 18 Â· Tailwind CSS |
| Backend | FastAPI + Uvicorn Â· Python 3.12 Â· asyncio Â· Pydantic v2 |
| Task queue | Celery 5 + Celery Beat |
| Cache / broker | Upstash Redis (`rediss://`) |
| Database | Supabase PostgreSQL Â· asyncpg |
| Auth | Supabase Auth + `@supabase/ssr` |
| AI validation | Anthropic Claude Haiku 4.5 (toggleable from dashboard) |
| Market data | Binance REST (spot + futures klines) |
| Coin data | Redis intelligence cache (optional CMC worker path) and CoinGecko runtime fallback |
| Notifications | Telegram Bot API |
| Indicators | pandas + numpy (TradingView-compatible Wilder EWM) |
| Hosting | Vercel (Next.js) Â· Railway (FastAPI + Celery worker) |

---

## Deployment (Railway + Vercel)

Current runtime note: the stabilized Python scanner does not currently consume CMC-derived signal influence. It reads the Redis intelligence cache only when that path is re-enabled; otherwise it falls back to CoinGecko listings.

### Services

| Service | Platform | Start Command |
|---------|----------|---------------|
| API | Railway | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
| Worker | Railway | `celery -A backend.workers.celery_app.celery_app worker --beat --loglevel=info --concurrency=2 -Q celery,scanner` |
| Frontend | Vercel | Auto (Next.js) |

### Railway worker settings
- **Builder**: Dockerfile (not Railpack)
- **Healthcheck Path**: `/health` (the worker starts a health HTTP server on `$PORT`)
- **Restart Policy**: On Failure

### Scheduled scans (Celery Beat)

| Task | Schedule | Mode |
|------|----------|------|
| Standard scan | Every 15 min | `spot` |
| High-confidence | Every 30 min (offset :05) | `high_confidence` |
| Futures scan | Every 30 min (offset :10) | `futures` |
| Outcome tracker | Every 10 min | â€” |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | âœ… | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | âœ… | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | âœ… | Supabase service role key (server-side only) |
| `DATABASE_URL` | âœ… | PostgreSQL DSN â€” use Supabase Transaction Pooler (port 6543) |
| `REDIS_URL` | âœ… | Upstash `rediss://` URL |
| `ADMIN_EMAILS` | âœ… | Comma-separated allowed admin emails |
| `ADMIN_SECRET` | âœ… | 32-byte hex â€” `openssl rand -hex 32` |
| `BACKEND_URL` | âœ… | Railway API service URL |
| `COINMARKETCAP_API_KEY` | optional | Optional for current runtime; used by TypeScript intelligence workers/provider health, not by the stabilized Python signal path |
| `ANTHROPIC_API_KEY` | âš  | Claude Haiku key â€” heuristic fallback if absent or disabled |
| `BINANCE_API_KEY` | âœ— | Unlocks higher Binance rate limits |
| `COINGECKO_API_KEY` | âœ— | CoinGecko fallback key |
| `TELEGRAM_BOT_TOKEN` | âœ— | Bot token for signal alerts |
| `TELEGRAM_CHAT_ID` | âœ— | Channel ID for signal alerts |

---

## Local Development

Current runtime note: `COINMARKETCAP_API_KEY` is optional for the stabilized Python signal path. It is only needed if you want the TypeScript intelligence workers and provider-health surfaces to use CMC.

```bash
# 1. Install dependencies
npm install
python -m venv .venv && .venv/Scripts/activate
pip install -r backend/requirements.txt

# 2. Configure env
cp .env.example .env.local
# Fill in Supabase, Redis, CMC, Anthropic keys

# 3. Apply Supabase migrations (SQL Editor)
#    database/schema.sql
#    database/backtest-schema.sql
#    database/analytics-schema.sql
#    database/admin-auth-migration.sql
#    database/experiments-migration.sql

# 4. Start services (3 terminals)
npm run dev                                                           # Terminal 1: Next.js
uvicorn backend.main:app --reload --port 8000                        # Terminal 2: FastAPI
celery -A backend.workers.celery_app.celery_app worker --beat -Q celery,scanner  # Terminal 3: Celery
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `signals` | Trading signals with indicators, risk grade, futures data |
| `scan_runs` | Audit log of every scan |
| `coins` | Top-200 coin metadata |
| `signal_outcomes` | TP/SL/timeout outcome tracking (populated by outcome tracker every 10 min) |
| `ai_call_log` | Every Claude API call â€” latency, tokens, validated/rejected |
| `scan_metrics_log` | Per-scan stats â€” coins scanned, signals found, duration |
| `analytics_snapshots` | Cached computed analytics (edge report, calibration) |
| `backtest_runs` | Backtest job metadata |
| `backtest_trades` | Individual simulated trades |
| `performance_stats` | Aggregated analytics |
| `settings_groups` | System settings (9 groups) |
| `settings_experiments` | Staged experiment rollouts |
| `admin_auth_log` | Login/logout audit log |

---

## API Routes

### Next.js (`/api/...`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/scanner/run` | Trigger scan (proxies to Python backend) |
| `GET` | `/api/signals` | Fetch recent signals (last 7 days, newest first) |
| `GET` | `/api/coins/top100` | Top 100 coins from the frontend CoinGecko cache helper |
| `GET/POST` | `/api/scanner/control` | Scheduler status, start/stop/pause/resume |
| `GET` | `/api/health` | Liveness probe |
| `POST` | `/api/backtest/run` | Run backtest |

### FastAPI (Railway, port 8000)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/health/ready` | Readiness: Redis + Postgres |
| `POST` | `/api/scanner/trigger` | Trigger on-demand scan |
| `GET` | `/api/analytics/edge/report` | Edge report (win rate, expectancy, Sharpe) |
| `GET` | `/api/settings/{group}` | Get settings group |
| `PATCH` | `/api/settings/{group}` | Update settings group |

---

## Telegram Alerts

Every signal that passes all 11 gates is sent to Telegram with full trade detail:

```
ðŸ“ˆ LONG â€” TON/USDT
Mode: FUTURES  |  Confidence: 95% ðŸ”¥ VERY HIGH
Grade: ðŸŸ¢ A  |  R:R: 1:2.5

ðŸ“Š Trade Levels
  Entry:  $3.2100
  Target: $3.6200  (+12.77%)
  Stop:   $2.9800  (-7.17%)

âš¡ Leverage: Up to 10Ã— (max safe: 15Ã—)

ðŸ“¡ Futures Intelligence
  Funding: 0.0120% ðŸ”´ (LONG_HEAVY)
  OI Trend: RISING  |  L/S: 1.34
  Momentum: 78/100

ðŸ”¬ Technical
  EMA Cross: GOLDEN_CROSS
  Pattern: Hammer

RSI: 62  |  Vol: 2.3Ã—  |  EMA200: above âœ…

ðŸ¤– Strong 4h bullish alignment with BB squeeze breakout

ðŸ• 2026-05-28 09:10 UTC  |  Next alert in 1h
```

### Deduplication

Current runtime note: duplicate same-direction 1h signals are suppressed for 60 minutes before DB save, Telegram send, and outcome registration. Telegram also keeps its own 1-hour alert cooldown.

The same coin+direction+timeframe is suppressed for 60 minutes before persistence and outcome registration, and Telegram still enforces its own 1-hour cooldown. If direction flips, it can fire immediately.

---

## Claude AI Credit Management

The Claude AI validation step can be toggled from **Admin â†’ Calibration** without redeploying:

- **Disable**: scans use heuristic scoring only â€” zero API credits consumed
- **Enable**: Claude validates each signal that passes all 11 prior gates
- Setting persists through worker restarts (stored in PostgreSQL via settings service)

### Credit-saving mode (built-in)

Current runtime note: `AI_MIN_SETUP_SCORE` is `78` in `ai_validator.py`. Signals below `78` automatically use heuristic validation instead of Claude.

`AI_MIN_SETUP_SCORE = 78` in `ai_validator.py` - signals with setup score < 78 automatically use heuristic instead of Claude. Only stronger setups (score >= 78) spend API credits.

| Setup Score | AI Validation | Credits Used |
|-------------|---------------|-------------|
| >= 78 | Claude Haiku | Yes |
| < 78 | Heuristic | No |

### Cost estimate (free $5 credits)

- With threshold: ~$0.23/day â†’ **$5 lasts ~22 days**
- Without threshold: ~$0.38/day â†’ $5 lasts ~13 days

### Anthropic rate limits

- Free tier: 5 req/min â†’ retries add ~30s per scan
- Tier 1 ($5 actual spend at console.anthropic.com): 50 req/min â†’ instant validation

---

## Phase 7.2B â€” Founder Settings & Operations Simplification (May 2026)

Redesigned admin dashboard for maximum operational clarity:

### UX Refinements (7.2B.1 â€“ 7.2B.6.6)
- **Settings** â†’ "Founder Control Center": 3 primary modes (Conservative/Balanced/Aggressive) + Advanced Presets (Institutional/Sniper/Futures Tactical/Rotation Hunter)
- **Providers** â†’ "Operations Dashboard": CMC/Binance/CoinGecko status cards, QuotaBurnForecast (Safe/Moderate/High), OperationsSummary (5 cells)
- **Regime page**: "Apply Regime Settings" button with preview modal; 6 regime â†’ mode mappings
- **Anomalies** â†’ "Anomaly Action Center": NEW/ACKNOWLEDGED/MUTED/RESOLVED state machine; 4 action buttons per anomaly; 4-tile summary
- **Sidebar reorganized**: TRADING DESK (Overview/Signals/Tactical/Settings) Â· MARKET (Intelligence/Regime/Sectors) Â· OPERATIONS (Scanner/Anomalies/Providers/Cache/System) Â· REVIEW (Analytics/Calibration)
- **Signals card intelligence**: Phase 7.2B.0 added TrendScore tier badge, Sector status, Breakout strength+type, OI interpretation, Funding trend, Positioning context
- **Signals/Tactical density**: Desktop columns added (Entry md+, Target% lg+, Stop% lg+); pagination (25/50/100 per page)
- **Topbar alerts**: "3 CRITICAL / WARN" badges now clickable links to /admin/anomalies; added pulsing icon

### Production Readiness Audit (7.2B.7)
- **Overall Score: 7.4/10** â€” CONDITIONAL GO
- **2 BLOCKERS**: .env.local git exposure risk, ADMIN_SECRET optional in lib/env.ts
- **5 HIGH PRIORITY**: console.log, Celery timeout, beat expiry, infra_collector exception loop, no per-minute Anthropic rate limit
- **6 MEDIUM PRIORITY**: setup score 60/AI threshold 72 dead zone, fire-and-forget logging, hardcoded refresh intervals, ATR floor missing, rejection persistence, score clamp
- See `docs/PRODUCTION_READINESS_AUDIT.md` for full audit

### Production Hardening (7.2B.7 â€” 7.2B.7.4A)

After the audit, all blockers and high-priority items resolved:

| Fix | Commit | Result |
|-----|--------|--------|
| ADMIN_SECRET enforced as `z.string().min(32)` | `478fc54` | Blocks deploy without secret |
| All `console.*` â†’ structured pino logger (34 instances) | `d37cba6` / `f5a7169` | Structured logging throughout |
| Celery `soft_time_limit` 840s â†’ 1020s; `time_limit` 960s â†’ 1140s | `74672c1` | Scans complete without kill |
| Beat `expires` 780s â†’ 1020s | `74672c1` | No queued scans dropped |
| `infra_collector._run_loop` wrapped in try/except | `74672c1` | Prometheus no longer dies silently |
| Per-minute Anthropic rate limiter (12 RPM sliding window) | `1a471c2` | No more 429 burst errors |
| Setup gate raised 60 â†’ 72 (dead zone eliminated) | `fe99495` | Cleaner signal threshold |
| Scheduler lock TTL 11 â†’ 20 min; exception safety | `3e9fde2` | No scan overlaps |
| OpenAPI endpoint disabled in production | `216e74f` | No schema exposure |
| `/metrics` requires X-Admin-Secret in production | `216e74f` | No public metrics |
| Anthropic daily call limit + degradation alerting | `8fe5df3` | Credit ceiling enforced |
| **Final production readiness: 9.1/10 â€” âœ… GO** | â€” | Deployed May 2026 |

---

## Phase 8.0 â€” Analytics Intelligence Wiring (May 2026)

Wired all 7 intelligence fields (TrendScore, Sector, Breakout, OI, Funding, Positioning, Regime) through the full analytics pipeline:

- **GAP-1/2**: `get_outcomes()` and `get_analytics()` return all 7 intelligence fields in group-by breakdowns
- **GAP-3**: `_fetch_outcomes()` in edge validation includes all 7 fields for attribution analysis
- **GAP-4**: `trend_score_tier()` helper (ELITE â‰¥ 80 / STRONG â‰¥ 60 / GOOD â‰¥ 40 / WEAK < 40)
- **GAP-5**: `GET /api/analytics/intelligence` endpoint â€” best-performing tier per dimension
- **GAP-6**: Intelligence Performance section on Analytics page

---

## Phase 8.1B â€” Native Python BTC Regime Gate (May 2026)

**Problem:** BTC regime was computed in TypeScript (`lib/market-regime.ts`) and not available to the Python scanner. The May 2026 incident showed 99 SELL signals at 0% win rate during a bull market reversal â€” the scanner had no macro context.

**Solution:** Native Python regime classification directly in the scanner:

- `get_btc_regime()` + `_classify_regime()` in `market_fetcher.py` â€” fetches BTC 4h klines, classifies regime
- **Soft gate** in `signal_pipeline.py`: BULL + SELL requires +10 confidence; BEAR + BUY requires +10; HIGH_VOLATILITY +5
- `market_regime` field persisted to `signals` table and `signal_outcomes`
- `by_market_regime` breakdown added to analytics
- Telegram alerts show regime emoji: ðŸŸ¢ BULL / ðŸ”´ BEAR / ðŸŸ¡ SIDEWAYS / ðŸŸ  VOLATILE

**Expected impact:** 9% â†’ ~24% win rate; âˆ’30% signal volume (regime-misaligned setups filtered)

---

## Phase MONITOR.1 â€” Post-Launch Operational Monitoring (May 2026)

14 daily Redis metric counters wired into scanner, Telegram, and analytics paths:

| Metric | Threshold (Healthy/Warning/Critical) |
|--------|-------------------------------------|
| Scans per day | â‰¥ 95 / 70â€“95 / < 70 |
| Signals per day | 1â€“30 / 0 or > 30 / 0 for 24h |
| Claude validation rate | â‰¥ 60% / 30â€“60% / < 30% |
| Claude fallback rate | < 20% / 20â€“50% / > 50% |
| Telegram delivery rate | â‰¥ 95% / 80â€“95% / < 80% |
| Binance error rate | < 2% / 2â€“10% / > 10% |
| Scan duration | < 10 min / 10â€“15 min / > 15 min |

- **Anomaly detection**: zero-signal day, Claude fallback spike, Binance errors, slow scan
- **Endpoint**: `GET /api/analytics/monitor` + System page Operational Monitoring section
- **Smoke test**: All 13 deploy scenarios verified â€” scanner, Claude, Telegram, emergency stop, maintenance mode

---

## License

Private â€” all rights reserved.


