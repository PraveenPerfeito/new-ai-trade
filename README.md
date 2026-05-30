# SignalEdge AI

AI-powered cryptocurrency trading signal scanner. Scans **200 coins** from CoinMarketCap, applies an 11-gate quality pipeline with advanced technical analysis, and surfaces high-probability setups via a glassmorphism admin dashboard and Telegram alerts.

**Stack:** Next.js 14 · TypeScript · FastAPI (Python 3.12) · Supabase · Upstash Redis · Claude Haiku · Binance API · CoinMarketCap · Railway

---

## Features

### Signal Pipeline (11 Gates)

1. **Multi-timeframe confirmation** — 1h + 4h + 1d candles must align
2. **Volatility gate** — ATR-based filter rejects extreme volatility
3. **Trend strength** — EMA/MACD composite score (0–100)
4. **Market structure** — 7 false-positive filters (doji, engulfing, fake breakout, wash trade, RSI divergence, overextension, S/R rejection)
5. **Setup scoring** — multi-factor quality score including:
   - EMA200 bounce detection (+15 pts, 4h/1h convergence guard with ≥250 candles)
   - Bollinger Band squeeze detection (+15 pts) with expansion confirmation
   - Daily timeframe alignment (+12 pts)
   - 10 candlestick patterns: Hammer, Shooting Star, Morning/Evening Star, Three White Soldiers/Black Crows, Marubozu, Inverted Hammer, Hanging Man
   - Fresh EMA crossover (Golden/Death Cross within 5 candles) (+12 pts)
   - Relative strength vs BTC 4h (+10 pts)
   - Breakout intelligence — 20/30-day high/low detection with BB expansion, EARLY_BREAKOUT/CONFIRMED/HIGH_MOMENTUM scoring (+5 to +12 pts)
6. **R:R ratio** — minimum 2:1 reward-to-risk
7. **Risk engine** — grade A–F, quality score, safe leverage tiers
8. **Futures intelligence** — directional funding rate with FAVORABLE/NORMAL/ELEVATED/EXTREME tiers, OI intelligence (NEW_LONGS/NEW_SHORTS/SHORT_COVERING/LONG_LIQUIDATION/NEUTRAL matrix), L/S positioning (EXTREME_LONG/LONG_HEAVY/BALANCED/SHORT_HEAVY/EXTREME_SHORT with contrarian scoring), funding trend (RISING/FALLING/STABLE with trend multiplier), liquidation zones (futures/high_confidence modes)
9. **Continuation gate** — probability score (10–95), rejects low-momentum setups
10. **Signal lifecycle** — DEVELOPING/CONFIRMED/EXTENDED/COOLING/CORRECTING/INVALIDATED/EXPIRED
11. **Claude AI validation** — Haiku validates final signal with full context (can be disabled from dashboard to conserve credits)

### Indicators (Pure Python — TradingView-matched)

- RSI(14) — Wilder EWM smoothing
- MACD — EMA(12) − EMA(26), signal EMA(9)
- EMA 20 / 50 / 200 (with convergence guards at ≥250 candles)
- ATR(14) — Wilder True Range
- Volume Spike — current vs 20-candle rolling avg (time-weighted)
- ADX — Wilder DI+/DI- (sideways market detection)
- Bollinger Bands (20, 2σ) — with squeeze & expansion detection
- Trend Strength Score (0–100 composite)
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
| Scanner Control | `/admin/scanner` | Start/stop/pause/resume/e-stop · mode & interval · rejection diagnostics |
| Signals (Intelligence Visibility) | `/admin/signals` | Live signal feed with **Intelligence section** (TrendScore, Sector, Breakout, OI, Funding, Positioning) |
| Tactical Feed | `/admin/tactical` | Signal lifecycle — colored accent bars per stage, preset filter buttons, responsive cards |
| Sector Rotation | `/admin/sectors` | Category cards with STRONGEST/ACCELERATING/WEAKENING/OVERCROWDED badges |
| Regime Intelligence | `/admin/regime` | RSI gauge, trading implication, **Apply Regime Settings button**, preview modal |
| Calibration | `/admin/calibration` | **Claude AI on/off toggle** · verdict distribution · confidence bands (3 sections) |
| Edge Analytics | `/admin/analytics` | Win rate, expectancy, profit factor, Sharpe — overflow-x-auto, secondary columns hidden mobile |
| Founder Control Center | `/admin/settings` | 3 primary modes (Conservative/Balanced/Aggressive), Advanced Presets, 4 key controls, Active Settings Summary |
| Operations Dashboard | `/admin/providers` | ProviderStatusBoard (CMC/Binance/CoinGecko), QuotaBurnForecast, CompactProviderCard (collapsed ~56px) |
| Cache & System Operations | `/admin/cache` · `/admin/system` | Hit-rate progress bars, fresh/stale count, compact workers; larger status banner |
| Anomaly Action Center | `/admin/anomalies` | 4 action buttons (Acknowledge/Mute/Resolve/Detail), state machine, 4-tile Active Issues summary |
| (Sidebar restructured) | — | TRADING DESK / MARKET / OPERATIONS / REVIEW groups, "SignalEdge" brand |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) · TypeScript 5 · React 18 · Tailwind CSS |
| Backend | FastAPI + Uvicorn · Python 3.12 · asyncio · Pydantic v2 |
| Task queue | Celery 5 + Celery Beat |
| Cache / broker | Upstash Redis (`rediss://`) |
| Database | Supabase PostgreSQL · asyncpg |
| Auth | Supabase Auth + `@supabase/ssr` |
| AI validation | Anthropic Claude Haiku 4.5 (toggleable from dashboard) |
| Market data | Binance REST (spot + futures klines) |
| Coin data | CoinMarketCap Pro (primary, 200 coins) · CoinGecko (fallback) |
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
| Outcome tracker | Every 10 min | — |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (server-side only) |
| `DATABASE_URL` | ✅ | PostgreSQL DSN — use Supabase Transaction Pooler (port 6543) |
| `REDIS_URL` | ✅ | Upstash `rediss://` URL |
| `ADMIN_EMAILS` | ✅ | Comma-separated allowed admin emails |
| `ADMIN_SECRET` | ✅ | 32-byte hex — `openssl rand -hex 32` |
| `BACKEND_URL` | ✅ | Railway API service URL |
| `COINMARKETCAP_API_KEY` | ✅ | CMC Startup Plan key (primary coin data source) |
| `ANTHROPIC_API_KEY` | ⚠ | Claude Haiku key — heuristic fallback if absent or disabled |
| `BINANCE_API_KEY` | ✗ | Unlocks higher Binance rate limits |
| `COINGECKO_API_KEY` | ✗ | CoinGecko fallback key |
| `TELEGRAM_BOT_TOKEN` | ✗ | Bot token for signal alerts |
| `TELEGRAM_CHAT_ID` | ✗ | Channel ID for signal alerts |

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
| `signal_outcomes` | TP/SL/timeout outcome tracking (populated by outcome tracker every 10 min) |
| `ai_call_log` | Every Claude API call — latency, tokens, validated/rejected |
| `scan_metrics_log` | Per-scan stats — coins scanned, signals found, duration |
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
| `GET` | `/api/coins/top100` | Top 200 coins from CMC via market-data service |
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
📈 LONG — TON/USDT
Mode: FUTURES  |  Confidence: 95% 🔥 VERY HIGH
Grade: 🟢 A  |  R:R: 1:2.5

📊 Trade Levels
  Entry:  $3.2100
  Target: $3.6200  (+12.77%)
  Stop:   $2.9800  (-7.17%)

⚡ Leverage: Up to 10× (max safe: 15×)

📡 Futures Intelligence
  Funding: 0.0120% 🔴 (LONG_HEAVY)
  OI Trend: RISING  |  L/S: 1.34
  Momentum: 78/100

🔬 Technical
  EMA Cross: GOLDEN_CROSS
  Pattern: Hammer

RSI: 62  |  Vol: 2.3×  |  EMA200: above ✅

🤖 Strong 4h bullish alignment with BB squeeze breakout

🕐 2026-05-28 09:10 UTC  |  Next alert in 1h
```

### Deduplication

`ALERT_COOLDOWN_HOURS = 1` in `telegram_notifier.py` — the same coin+direction (e.g. TON LONG) cannot alert again for 1 hour. If the direction flips (LONG → SHORT), it fires immediately regardless. Cooldown stored as a Redis key `tg:alert:{SYMBOL}:{LONG|SHORT}`.

---

## Claude AI Credit Management

The Claude AI validation step can be toggled from **Admin → Calibration** without redeploying:

- **Disable**: scans use heuristic scoring only — zero API credits consumed
- **Enable**: Claude validates each signal that passes all 11 prior gates
- Setting persists through worker restarts (stored in PostgreSQL via settings service)

### Credit-saving mode (built-in)

`AI_MIN_SETUP_SCORE = 72` in `ai_validator.py` — signals with setup score < 72 (borderline setups) automatically use heuristic instead of Claude. Only high-quality setups (score ≥ 72) spend API credits. This reduces Claude calls by ~40% with no loss in signal quality.

| Setup Score | AI Validation | Credits Used |
|-------------|---------------|-------------|
| ≥ 72 | Claude Haiku | Yes |
| < 72 | Heuristic | No |

### Cost estimate (free $5 credits)

- With threshold: ~$0.23/day → **$5 lasts ~22 days**
- Without threshold: ~$0.38/day → $5 lasts ~13 days

### Anthropic rate limits

- Free tier: 5 req/min → retries add ~30s per scan
- Tier 1 ($5 actual spend at console.anthropic.com): 50 req/min → instant validation

---

## Phase 7.2B — Founder Settings & Operations Simplification (May 2026)

Redesigned admin dashboard for maximum operational clarity:

### UX Refinements (7.2B.1 – 7.2B.6.6)
- **Settings** → "Founder Control Center": 3 primary modes (Conservative/Balanced/Aggressive) + Advanced Presets (Institutional/Sniper/Futures Tactical/Rotation Hunter)
- **Providers** → "Operations Dashboard": CMC/Binance/CoinGecko status cards, QuotaBurnForecast (Safe/Moderate/High), OperationsSummary (5 cells)
- **Regime page**: "Apply Regime Settings" button with preview modal; 6 regime → mode mappings
- **Anomalies** → "Anomaly Action Center": NEW/ACKNOWLEDGED/MUTED/RESOLVED state machine; 4 action buttons per anomaly; 4-tile summary
- **Sidebar reorganized**: TRADING DESK (Overview/Signals/Tactical/Settings) · MARKET (Intelligence/Regime/Sectors) · OPERATIONS (Scanner/Anomalies/Providers/Cache/System) · REVIEW (Analytics/Calibration)
- **Signals card intelligence**: Phase 7.2B.0 added TrendScore tier badge, Sector status, Breakout strength+type, OI interpretation, Funding trend, Positioning context
- **Signals/Tactical density**: Desktop columns added (Entry md+, Target% lg+, Stop% lg+); pagination (25/50/100 per page)
- **Topbar alerts**: "3 CRITICAL / WARN" badges now clickable links to /admin/anomalies; added pulsing icon

### Production Readiness Audit (7.2B.7)
- **Overall Score: 7.4/10** — CONDITIONAL GO
- **2 BLOCKERS**: .env.local git exposure risk, ADMIN_SECRET optional in lib/env.ts
- **5 HIGH PRIORITY**: console.log, Celery timeout, beat expiry, infra_collector exception loop, no per-minute Anthropic rate limit
- **6 MEDIUM PRIORITY**: setup score 60/AI threshold 72 dead zone, fire-and-forget logging, hardcoded refresh intervals, ATR floor missing, rejection persistence, score clamp
- See `docs/PRODUCTION_READINESS_AUDIT.md` for full audit

---

## License

Private — all rights reserved.
