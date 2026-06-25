# INFRASTRUCTURE MASTER
<!-- Consolidated from: CMC_REDIS_TRUTH_1, SYSTEM_STABILIZATION_FINAL_1 (sections C/D/E), STABILIZATION_CLOSEOUT_1 -->
<!-- Last updated: 2026-06-23 · Authoritative source for Redis, cloud stack, CMC, and ops infrastructure -->

---

## SECTION 1 — Cloud Stack

### Railway (Python backend)
- **FastAPI** + uvicorn, `PORT` env var
- **Celery worker:** `python -m celery -A backend.workers.celery_app worker`
- **Beat scheduler:** `celery -A backend.workers.celery_app beat`
- **Health check:** `GET /health/ready` → checks Redis, PostgreSQL, Binance, Anthropic, WhatsApp
- **Worker heartbeat:** writes `celery:worker:last_heartbeat` on `worker_ready` + refreshes every **600s** via beat task
- **Broker:** CloudAMQP (AMQP) — eliminates ~34,560 Redis BLPOP ops/day
- **Result backend:** `rpc://` — zero Redis for task results

### Vercel (Next.js)
- **Cron routes:** `/api/intelligence/cron/global` + `/api/intelligence/cron/categories` (hourly)
- **Admin proxy:** `app/api/admin/[...path]/route.ts` → Railway backend, injects `X-Admin-Secret`
- **Auth:** middleware.ts (Edge) — Supabase session + `ADMIN_EMAILS` allowlist
- **Runtime:** `nodejs` on all API routes (not Edge)

### Redis Cloud (Essentials)
- **URL:** `smell-aware-macromodern-12096.db.redis.io:15686`
- **SSL:** required (TLS cert verification disabled in production for compatibility)
- **SchedulerCoordinator:** uses Redis directly (not broker URL) — distributed locks, enable/disable state
- **Fail-open:** `is_enabled()` and `acquire_scan_lock()` catch all Redis exceptions and return `True`

### CloudAMQP
- **URL:** `warthog.lmq.cloudamqp.com/nykbebbj` (new instance after old `armadillo` quota exhausted June 24)
- **Purpose:** Celery task broker only (not SchedulerCoordinator)
- **Heartbeat:** 600s (was 60s → saves 4,320 msgs/month)

### Supabase
- **PostgreSQL** via asyncpg connection pool (`get_pool()`)
- **Auth:** `@supabase/ssr`, `createSupabaseServerClient` / `BrowserClient` / `AdminClient`
- **All 7 migrations applied** (confirmed June 16 — see Section 3)

---

## SECTION 2 — Redis Key Audit (50 keys total)

### CRITICAL — Pipeline and delivery

| Key Pattern | Purpose | TTL | Ops/day |
|-------------|---------|-----|---------|
| `cache:intel:listings` | CMC 200-coin listings | 5 min | ~288 reads |
| `cache:intel:trending` | CMC trending coins | 5 min | ~288 reads |
| `cache:intel:sector:*` | CMC sector data | 60 min | ~48 reads |
| `cache:intel:global` | CMC global metrics | 60 min | ~48 reads |
| `tg:alert:{SYMBOL}:{LONG\|SHORT}` | WhatsApp dedup cooldown | 1h | ~20 reads/writes |
| `scheduler:enabled` | Scanner on/off state | no expiry | ~96 reads |
| `scheduler:lock:{mode}` | Per-mode scan lock | 20 min | ~96 reads |
| `last_scan_ts` | Last scan timestamp | 7 days | ~96 reads |
| `celery:worker:last_heartbeat` | Celery health check | 1800s | 1 write/600s |
| `settings:{group}:{key}` | Settings 1h cache | 1h | ~50 reads |
| `settings:pub:*` | Settings change pub/sub | 10 min | varies |

### USEFUL — Monitoring

| Key Pattern | Purpose | TTL | Ops/day |
|-------------|---------|-----|---------|
| `monitor:{today}:signals` | Daily signal counter | midnight | ~350 incr |
| `monitor:{today}:telegram_sends` | Daily send counter | midnight | ~20 incr |
| `monitor:{today}:binance_errors` | Daily Binance error counter | midnight | varies |
| `monitor:{today}:claude_calls` | Daily Claude call counter | midnight | ~0 (AI off) |
| `kline:batch:*` | Binance kline metric batch (5s window) | 5s | ~240 batches |
| `intel:fallback:status` | CMC cache cold indicator | 30 min | rare |

### OPTIMIZE — Consider reducing

| Key | Recommendation |
|-----|---------------|
| `monitor:anomaly:*` | Keep — anomaly detection depends on them |
| `scheduler:status_cache` | TTL raised 300s→600s (FIXES.4) |
| `health:snapshot` | TTL raised 30s→60s (STABILIZATION_CLOSEOUT) |
| `orchestrator:progress:*` | TTL reduced 1h→15min (STABILIZATION_CLOSEOUT) |

### Batch optimization (active)
`_record_binance_kline_metric()` accumulates successes/latencies/errors for **5 seconds**, then flushes a single Redis pipeline. Reduces from ~240 individual pipelines/scan to 1 (~98% reduction).

---

## SECTION 3 — Database Migrations (all 7 applied June 16)

| File | Purpose | Idempotent |
|------|---------|-----------|
| `probability-gate-migration.sql` | `probability_gate_enabled` flag | ✅ IF NOT EXISTS |
| `probability-engine-migration.sql` | `empirical_grade/wr/n` columns on signals | ✅ IF NOT EXISTS |
| `telegram-delivery-migration.sql` | `telegram_delivered` + `telegram_delivery_error` cols | ✅ IF NOT EXISTS |
| `validation-source-migration.sql` | `validation_source` column on signals | ✅ IF NOT EXISTS |
| `ai-call-log-trace-migration.sql` | `symbol` + `setup_score` on `ai_call_log` | ✅ IF NOT EXISTS |
| `attribution-snapshots-migration.sql` | `attribution_snapshots` table | ✅ IF NOT EXISTS |
| `signal-outcomes-regime-migration.sql` | `market_regime` on `signal_outcomes` | ✅ IF NOT EXISTS |

All are safe to re-run. For a fresh deploy: run all 7 files in Supabase SQL Editor in any order.

---

## SECTION 4 — CMC Field Classification

### CRITICAL (gate/scoring decisions depend on these)
| Field | Used For | Risk If Missing |
|-------|---------|----------------|
| `quote.USD.price` | Entry/TP/SL price calculation | Signal generation fails |
| `quote.USD.percent_change_24h` | BTC context gate (BTC_DOWN_BUY) | Gate bypassed |
| `cmc_rank` | TrendScore component | Lower-quality universe |
| `quote.USD.volume_24h` | Volume gate (min_vol) | Low-quality signals pass |
| `quote.USD.market_cap` | Market cap filter (min_mcap) | Micro-caps pass |
| `category_id` / `tags` | Sector classification | Sector intelligence fails |
| `circulating_supply` | Market cap tier calculation | Tier misclassification |

### USEFUL (scoring inputs, not hard gates)
| Field | Used For |
|-------|---------|
| `platform` | Chain context (ERC20, BEP20, etc.) |
| `max_supply` | Tokenomics context |
| `quote.USD.percent_change_7d` | Medium-term momentum |
| `quote.USD.market_cap_dominance` | Relative market size |
| `quote.USD.percent_change_1h` | Short-term momentum |

### DISPLAY ONLY (UI only, no gate/scoring consumers)
`symbol, name, num_market_pairs, date_added, twitter_username, quote.USD.fully_diluted_market_cap`

### NOT CMC — highest-alpha intelligence comes from Binance
- `market_regime` (BTC 4h classification) → Binance klines
- `breakout_strength` (EARLY/CONFIRMED/HIGH_MOMENTUM) → Binance klines
- `oi_interpretation` (NEW_LONGS/SHORT_COVERING/etc.) → Binance futures API
- `funding_trend` (RISING/FALLING/STABLE) → Binance funding rate
- `positioning_context` (EXTREME_SHORT/LONG/etc.) → Binance long/short ratio

---

## SECTION 5 — Operations Budget Targets

### Redis (target: <200K ops/month)
- Actual: ~44K ops/day × 30 = ~1.32M ops/month [post-OPS.CONSOLIDATION.1 estimate; CMC_REDIS_TRUTH_1 measured ~77K/day before CloudAMQP]
- Note: SYSTEM_STABILIZATION_FINAL estimated ~66K/month — CMC_REDIS_TRUTH_1 is more accurate
- Savings applied: CloudAMQP broker (−34,560 BLPOP/day), kline batching (−98%), heartbeat 600s, hourly cron

**Warning:** ~1.32M/month exceeds the original 200K/month target. The original target was based on a smaller key count. The actual budget needs re-evaluation with the Redis Cloud plan limits.

### CloudAMQP (target: <39K msgs/month)
- Celery tasks: SPOT 96/day + FUTURES 48/day + TRENDING 48/day = 192 scans/day × 30 = ~5,760 task msgs/month
- Beat heartbeat: 600s interval → ~4,320 msgs/month
- Total estimate: ~16,000 msgs/month (well within 39K target)

### CMC API (target: budget-safe)
- Usage: ~216 credits/day (2.2% of 300K monthly budget)
- Consumption: TypeScript workers fetch once every ~5 min, Python reads Redis cache only
- No duplicate calls between Python and TypeScript

---

## SECTION 6 — Health Check Architecture

### `/health/ready` (Python, Railway)
Checks (per `backend/api/health.py`):
- `redis`: ping test
- `postgres`: connection pool ping
- `binance`: last successful kline fetch within 10 min
- `anthropic`: env var present (not API call)
- `whatsapp`: env vars present (not API call)
- `celery_worker`: heartbeat age < 900s (1.5× 600s beat interval)

Status values: `HEALTHY` / `DEGRADED` / `OFFLINE` (not `'ok'` — frontend bug fixed in commit `70c7f93`)

### WhatsApp/Anthropic health check
Checked by **token presence only** (not API round-trip). Token present = healthy.
Avoids: 4001ms timeout from Vercel geo-restricting Telegram-style checks.

### Telegram false-DOWN fix (SYSTEM.DIAGNOSTICS.1)
`checkTelegram()` was calling `api.telegram.org/getMe` from Vercel → 4001ms timeout → false DOWN.
Fixed: token-presence check only. UltraMsg/WhatsApp health is covered by Railway health check.

---

## SECTION 7 — WhatsApp Delivery Stack

**Platform:** UltraMsg (instance181885, +919600190022)
**Source code says:** "Telegram" — maps to WhatsApp delivery channel throughout codebase.
All new documents use "WhatsApp."

### Delivery reliability fixes (TELEGRAM.RELIABILITY.1)
- **WS1:** `flush_queue(30s)` drain before scan event loop exit — prevents tail signal loss
- **WS2:** `_QueueItem(text, signal_id, dedup_key)` — writes `signals.telegram_delivered` after confirmed 200 response
- **WS3:** Dedup cooldown (SETEX) moved to AFTER confirmed 200 — failed sends no longer poison 1h cooldown
- **WS4:** Semaphore/rate limiter recreate per running loop — fixes "bound to different event loop" crash
- **WS5:** `GET /api/analytics/telegram-delivery` endpoint + TelegramDeliveryCard

**Dedup:** `tg:alert:{SYMBOL}:{LONG|SHORT}` Redis key, 1h TTL. Direction flip → delivers immediately. Quality-aware dedup: stored confidence; signal with confidence ≥ previous + 5 → ⬆ UPGRADE alert.

**Ops alerts:** `telegram.ops_alerts_enabled` (default **false**). Signal alerts always on; ops alerts (scan failures, anomalies, AI degradation, Binance geo-block) gated by this setting.

**Note:** `telegram_delivered=NULL` for pre-WS2 signals (~626 sent before fix) — this is expected, not an error.

---

## SECTION 8 — Celery Beat Schedule

| Task | Interval | Purpose |
|------|----------|---------|
| `run_scheduled_scan` (spot) | Every 15 min (*/15) | SPOT mode scan |
| `run_scheduled_scan` (futures) | Every 30 min (at :10,:40) | FUTURES mode scan |
| `run_scheduled_scan` (trending) | Every 30 min (at :20,:50) | TRENDING mode scan |
| `check_signal_outcomes` | Every 30 min | Outcome resolution |
| `worker-heartbeat` | Every 600s | Railway health check |
| `nightly-attribution` | 00:15 UTC daily | Attribution snapshots |
| `anomaly-check` | Every 2h | Anomaly detection |

HIGH_CONFIDENCE scan: **removed from beat schedule** (permanently disabled since dd10788 — 0/9 wins last week, saves 1,440 msgs/month).

---

## SECTION 9 — Environment Variables

### Railway (Python backend) — required
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
REDIS_URL=redis://default:...@smell-aware-macromodern-12096.db.redis.io:15686
CELERY_BROKER_URL=amqps://nykbebbj:...@warthog.lmq.cloudamqp.com/nykbebbj
CELERY_RESULT_BACKEND=rpc://
ADMIN_SECRET=<32-byte hex>
BINANCE_API_KEY, BINANCE_SECRET_KEY
COINMARKETCAP_API_KEY
WHATSAPP_API_URL=https://api.ultramsg.com/instance181885/
WHATSAPP_TOKEN=<UltraMsg instance token>
WHATSAPP_PHONE=+919600190022
# ANTHROPIC_API_KEY — currently unset (100% heuristic)
```

### Vercel (Next.js) — required
```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
ADMIN_EMAILS=<admin email>
ADMIN_SECRET=<same 32-byte hex as Railway>
BACKEND_URL=https://crypto-scanner-api-production.up.railway.app
# XAI_API_KEY — not set; News tab deleted from UI
```

### Security notes
- `.env` / `.env.local` are gitignored — never commit
- `ADMIN_SECRET` blocks all admin access if unset in production
- `ADMIN_EMAILS` blocks all admin access if unset
- Redis URL contains credentials — treat as secret
