# SignalEdge AI

AI-powered cryptocurrency trading signal scanner. Scans a cached large-cap and mid-cap universe, applies an 11-gate quality pipeline with advanced technical analysis, and surfaces high-probability setups via a glassmorphism admin dashboard and Telegram alerts.

**Stack:** Next.js 14 · TypeScript · FastAPI (Python 3.12) · Supabase · Redis Cloud · Claude Haiku · Binance API · CoinMarketCap · Railway

---

## Current Runtime Notes (2026-06-09)

- Scanner signals use closed Binance candles only. The currently open spot/futures candle is dropped before indicators and setup scoring run.
- Duplicate same-direction 1h signals are suppressed before DB save, Telegram send, and outcome registration.
- CMC-derived signal influence is currently disabled in the Python scanner until `trend_score` and `sector_status` attribution is measurable again in resolved outcomes. The live scanner falls back to CoinGecko listings for its runtime universe.
- Pure `bb_expansion` is not accepted as a standalone breakout path. BB context only boosts a structural breakout.
- A narrow denylist now rejects proven toxic `breakout_type=NULL` setup templates, while surviving NULL setups receive confidence penalties instead of a blanket family removal.

---

## Features

### Signal Pipeline (11 Gates)

1. **Multi-timeframe confirmation** -- 1h + 4h + 1d candles must align
2. **Volatility gate** -- ATR-based filter rejects extreme volatility
3. **Trend strength** -- EMA/MACD composite score (0-100)
4. **Market structure** -- 7 false-positive filters (doji, engulfing, fake breakout, wash trade, RSI divergence, overextension, S/R rejection)
5. **Setup scoring** -- multi-factor quality score including:
   - EMA200 bounce detection (+15 pts, 4h/1h convergence guard with >=250 candles)
   - Bollinger Band squeeze detection (+15 pts); pure BB expansion is not treated as a standalone breakout
   - Daily timeframe alignment (+12 pts)
   - 10 candlestick patterns: Hammer, Shooting Star, Morning/Evening Star, Three White Soldiers/Black Crows, Marubozu, Inverted Hammer, Hanging Man
   - Fresh EMA crossover (Golden/Death Cross within 5 candles) (+12 pts)
   - Relative strength vs BTC 4h (+10 pts)
   - Toxic non-breakout templates are hard-rejected; surviving `breakout_type=NULL` setups are penalized by direction, mode, volatility, and context
   - Breakout intelligence -- 20/30-day high/low detection with BB expansion, EARLY_BREAKOUT/CONFIRMED/HIGH_MOMENTUM scoring (+5 to +12 pts)
6. **R:R ratio** -- minimum 2:1 reward-to-risk
7. **Risk engine** -- grade A-F, quality score, safe leverage tiers
8. **Futures intelligence** -- directional funding rate with FAVORABLE/NORMAL/ELEVATED/EXTREME tiers, OI intelligence (NEW_LONGS/NEW_SHORTS/SHORT_COVERING/LONG_LIQUIDATION/NEUTRAL matrix), L/S positioning (EXTREME_LONG/LONG_HEAVY/BALANCED/SHORT_HEAVY/EXTREME_SHORT with contrarian scoring), funding trend (RISING/FALLING/STABLE with trend multiplier), liquidation zones (futures/high_confidence modes)
9. **Continuation gate** -- probability score (10-95), rejects low-momentum setups
10. **Signal lifecycle** -- DEVELOPING/CONFIRMED/EXTENDED/COOLING/CORRECTING/INVALIDATED/EXPIRED
11. **Claude AI validation** -- Haiku validates final signal with full context (can be disabled from dashboard to conserve credits)

### Indicators (Pure Python -- TradingView-matched)

- RSI(14) -- Wilder EWM smoothing
- MACD -- EMA(12) - EMA(26), signal EMA(9)
- EMA 20 / 50 / 200 (with convergence guards at >=250 candles)
- ATR(14) -- Wilder True Range
- Volume Spike -- current vs 20-candle rolling avg (time-weighted)
- ADX -- Wilder DI+/DI- (sideways market detection)
- Bollinger Bands (20, 2σ) -- with squeeze & expansion detection
- Trend Strength Score (0-100 composite)
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

### Admin Command Center

| Page | Path | Description |
|------|------|-------------|
| Command Overview | `/admin/overview` | Scanner status, regime card, signal metrics, recent signals, live next-scan countdown |
| Market Intelligence | `/admin/market` | Hero regime card, compact breadth bar, 6 trending coins |
| Scanner Control | `/admin/scanner` | Start/stop/pause/resume/e-stop · mode & interval · rejection diagnostics |
| Signals | `/admin/signals` | Live signal feed with Intelligence section (TrendScore, Sector, Breakout, OI, Funding, Positioning) |
| Tactical Feed | `/admin/tactical` | Signal lifecycle -- colored accent bars per stage, preset filter buttons, responsive cards |
| Sector Rotation | `/admin/sectors` | Category cards with STRONGEST/ACCELERATING/WEAKENING/OVERCROWDED badges |
| Regime Intelligence | `/admin/regime` | RSI gauge, trading implication, Apply Regime Settings button, preview modal |
| AI Calibration | `/admin/calibration` | Claude AI on/off toggle · verdict distribution · confidence bands |
| Edge Analytics | `/admin/analytics` | Win rate, expectancy, profit factor, Sharpe |
| Founder Control Center | `/admin/settings` | 3 primary modes (Conservative/Balanced/Aggressive), Advanced Presets, 4 key controls |
| Operations Dashboard | `/admin/providers` | ProviderStatusBoard (CMC/Binance/CoinGecko), QuotaBurnForecast, CompactProviderCard |
| Cache & System | `/admin/cache` · `/admin/system` | Hit-rate progress bars, fresh/stale count, service health, pipeline integrity |
| Anomaly Action Center | `/admin/anomalies` | 4 action buttons (Acknowledge/Mute/Resolve/Detail), state machine, 4-tile Active Issues summary |

Sidebar groups: **TRADING DESK** (Overview/Signals/Tactical/Settings) · **MARKET** (Intelligence/Regime/Sectors) · **OPERATIONS** (Scanner/Anomalies/Providers/Cache/System) · **REVIEW** (Analytics/Calibration)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) · TypeScript 5 · React 18 · Tailwind CSS |
| Backend | FastAPI + Uvicorn · Python 3.12 · asyncio · Pydantic v2 |
| Task queue | Celery 5 + Celery Beat |
| Cache / pub-sub | Redis Cloud (`rediss://`) |
| Message broker | CloudAMQP (AMQP) -- Celery tasks only |
| Database | Supabase PostgreSQL · asyncpg |
| Auth | Supabase Auth + `@supabase/ssr` |
| AI validation | Anthropic Claude Haiku 4.5 (toggleable from dashboard) |
| Market data | Binance REST (spot + futures klines) |
| Coin data | Redis intelligence cache (optional CMC worker path) + CoinGecko runtime fallback |
| Notifications | Telegram Bot API |
| Indicators | pandas + numpy (TradingView-compatible Wilder EWM) |
| Hosting | Vercel (Next.js) · Railway (FastAPI + Celery worker) |

---

## Deployment (Railway + Vercel)

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
| Trending scan | Every 30 min (offset :20) | `trending` |
| Outcome tracker | Every 30 min | -- |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase service role key (server-side only) |
| `DATABASE_URL` | yes | PostgreSQL DSN -- use Supabase Transaction Pooler (port 6543) |
| `REDIS_URL` | yes | Redis Cloud `rediss://` URL |
| `ADMIN_EMAILS` | yes | Comma-separated allowed admin emails |
| `ADMIN_SECRET` | yes | 32-byte hex -- `openssl rand -hex 32` |
| `BACKEND_URL` | yes | Railway API service URL |
| `CELERY_BROKER_URL` | yes | CloudAMQP `amqps://` URL |
| `COINMARKETCAP_API_KEY` | optional | Used by TypeScript intelligence workers; not required for the Python signal path |
| `ANTHROPIC_API_KEY` | optional | Claude Haiku key -- heuristic fallback if absent or disabled |
| `BINANCE_API_KEY` | optional | Unlocks higher Binance rate limits |
| `COINGECKO_API_KEY` | optional | CoinGecko fallback key |
| `TELEGRAM_BOT_TOKEN` | optional | Bot token for signal alerts |
| `TELEGRAM_CHAT_ID` | optional | Channel ID for signal alerts |

---

## Local Development

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
| `signal_outcomes` | TP/SL/timeout outcome tracking |
| `ai_call_log` | Every Claude API call -- latency, tokens, validated/rejected |
| `scan_metrics_log` | Per-scan stats -- coins scanned, signals found, duration, gate rejections |
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
| `GET` | `/api/signals/counts` | DB-authoritative signal counts (today, active, win rate 7d, expectancy 7d) |
| `GET` | `/api/coins/top100` | Top 100 coins from the frontend CoinGecko cache helper |
| `GET/POST` | `/api/scanner/control` | Scheduler status, start/stop/pause/resume |
| `GET` | `/api/health` | Liveness probe |
| `GET` | `/api/health/providers` | 8-provider health check (Binance, CMC, CoinGecko, Claude, Telegram, Supabase, Redis, CloudAMQP) |
| `GET` | `/api/news` | News intelligence snapshot (Fear & Greed + headlines -- informational only, never influences signals) |

### FastAPI (Railway, port 8000)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/health/ready` | Readiness: Redis + Postgres |
| `POST` | `/api/scanner/trigger` | Trigger on-demand scan |
| `GET` | `/api/analytics/edge/report` | Edge report (win rate, expectancy, Sharpe) |
| `GET` | `/api/analytics/monitor` | 14-metric operational monitoring snapshot |
| `GET` | `/api/settings/{group}` | Get settings group |
| `PATCH` | `/api/settings/{group}` | Update settings group |

---

## Telegram Alerts

Every signal that passes all 11 gates is sent to Telegram with full trade detail including:

- Entry / Target / Stop with % moves
- Grade (A-F) and R:R ratio
- Leverage recommendation
- Futures intelligence (Funding, OI, L/S ratio, Momentum)
- Technical context (EMA cross, pattern, RSI, volume)
- Claude AI narrative
- Breakout type and sector status

**Deduplication:** Same coin+direction suppressed for 60 minutes. Direction flip (BUY -> SELL) fires immediately.

---

## Claude AI Credit Management

The Claude AI validation step can be toggled from **Admin -> Calibration** without redeploying:

- **Disable**: scans use heuristic scoring only -- zero API credits consumed
- **Enable**: Claude validates each signal that passes all 11 prior gates
- Setting persists through worker restarts (stored in PostgreSQL via settings service)

### Credit-saving mode (built-in)

Signals with setup score < 78 automatically use heuristic instead of Claude. Only stronger setups (score >= 78) spend API credits (~50% credit reduction).

| Setup Score | AI Validation | Credits Used |
|-------------|---------------|-------------|
| >= 78 | Claude Haiku | Yes |
| < 78 | Heuristic | No |

### Cost estimate (free $5 credits)

- With threshold: ~$0.23/day -> **$5 lasts ~22 days**
- Without threshold: ~$0.38/day -> $5 lasts ~13 days

---

## Production Hardening (PLATFORM.TRUTH.MASTER.1 -- June 2026)

| Area | What changed |
|------|-------------|
| Dashboard metrics | DB-authoritative counts replace Redis estimates (signals today, active signals, win rate, expectancy) |
| Calibration page | Stripped to AI diagnostics only -- removed 8 duplicate widgets |
| Provider health | 8-provider unified health table (Binance, CMC, CoinGecko, Claude, Telegram, Supabase, Redis, CloudAMQP) |
| News intelligence | Fear & Greed + headlines panel; hard "informational only" barrier -- never influences signals |
| CloudAMQP traffic | Heartbeat 240s -> 600s + outcome tracker */10 -> */30 + ignore_result=True: saves ~6,480 msgs/month |
| Silent failures | P0/P1 bare `except: pass` blocks replaced with structured pino/structlog logging |
| Pipeline integrity | 12 canonical gate keys tracked per scan; score displayed on System page |
| Redis ops | ~430K -> ~330K ops/month (health cache 90s, heartbeat 600s, monitoring fixes) |

---

## Grade Calibration (RISKGRADE.FIX.1 -- June 2026)

Audit found Grade C had 9.8x better expectancy than Grade A (root cause: flat +5 futures penalty pushing quality futures signals from B -> C).

**Fix applied:**
- Futures risk penalty: +5.0 -> +2.0
- Breakout quality bonus: HIGH_MOMENTUM +15, CONFIRMED +10, EARLY +4
- Regime quality adjustment: BEAR/BULL/CAPITULATION/EUPHORIA +5, UNKNOWN/NULL -10
- `RiskResult.grade_factors` telemetry dict for post-deployment analysis

**Expected outcome:** Grade A WR ~42-48% (was 35%), Grade C shrinks to residual borderline signals only.

---

## License

Private -- all rights reserved.
