# Phase OPS.CONSOLIDATION.1 — Admin Dashboard + Redis + CloudAMQP Optimization

**Date:** 2026-06-09  
**Baseline:** ~430K Redis ops/month · ~55,500 CloudAMQP msgs/month · 13 admin pages  
**Target:** <200K Redis ops/month · <39K CloudAMQP msgs/month · 3 top-level pages  
**Scope:** Dashboard UX, Redis hotspots, polling, duplicate telemetry, broken metrics  
**Out of scope:** Signal generation, scanner logic, intelligence pipeline, risk engine, outcome tracking

---

## SECTION A — DASHBOARD CONSOLIDATION

### Current Navigation (13 pages, 4 groups)

```
TRADING DESK:  Overview · Signals · Tactical · Settings
MARKET:        Intelligence · Regime · Sectors
OPERATIONS:    Scanner · Anomalies · Providers · Cache · System
REVIEW:        Analytics · Calibration
```

### Widget × Redis Audit

| Page | Widgets | Poll Interval | Redis Ops/Poll | Redis Ops/Day (2h active) | Classification |
|------|---------|---------------|----------------|--------------------------|----------------|
| **Overview** | Scanner status, Regime card, Provider strip, Cache status, Signal pills, Recent signals | 60s | 3 | 360 | MERGE → Trading Ops |
| **Scanner** | Ops toggles (5), Scheduler status, Manual scan, Gate rejection grid | 60s | 3 | 360 | MERGE → Trading Ops |
| **System** | Health banner, Service grid, Monitor metrics, Gate rejection, Market structure | 60s monitor, 120s others | 11 | 660 | MERGE → Trading Ops |
| **Signals** | Signal cards (expandable), Filters, Edge summary, Lifecycle pills | 60s | 0 (DB only) | 0 | MERGE → Trading Ops |
| **Tactical** | Tactical signal table, preset buttons, live counts | manual | 0 | 0 | MERGE → Trading Ops |
| **Intelligence** | CMC data, trending, global metrics | manual | 0 | 0 | MERGE → Intel Center |
| **Regime** | Regime hero, RSI gauge, BTC stats, implication card, apply modal | 120s | 0 | 0 | MERGE → Intel Center |
| **Sectors** | Category cards with status badges | manual | 0 | 0 | MERGE → Intel Center |
| **Cache** | Cache groups (4), Quota bar, Background workers | 60s | 12 | 1,440 | MERGE → Intel Center |
| **Providers** | Provider status (3 cards), Ops summary, Quota forecast | 60s | 3 | 360 | MERGE → Intel Center |
| **Anomalies** | Issues tiles (4), Anomaly feed, Detail drawer | 60s | 2 | 240 | MERGE → Analytics |
| **Analytics** | Edge validation, Intelligence perf, Attribution tabs | 120-300s | 0 | 0 | KEEP → Analytics |
| **Calibration** | AI toggle, Claude metrics, Verdict dist, Confidence bands | 120s | 0 | 0 | MERGE → Analytics |
| **Settings** | Mode cards, Founder summary, Tactical controls, Audit log | on-mount | 0 | 0 | KEEP (standalone) |

### Proposed: 3 Top-Level Pages

---

#### PAGE 1: Trading Operations

**Route:** `/admin`  
**Merges:** Overview + Scanner + System + Signals + Tactical

**Tabs:**
- **Live** — Scanner status · Ops toggles · Regime pill · Recent signals (last 12)
- **Signals** — Full signal feed with filters, expand cards
- **Monitor** — Health banner · Service grid · Monitor metrics · Gate rejection grid

**Polling after consolidation:**
- Scheduler status: 180s (was 60s in Scanner, 60s in Overview) — saves 2 fewer calls/cycle
- Monitor snapshot: 180s (was 60s in System) — saves 2/3 of monitor Redis ops
- Signals: 120s (was 60s) — DB-only, no Redis impact but reduces API load
- Health: 300s (was 120s) — 2 Redis ops, rarely changes

**Redis ops/day reduction:** 1,380 → 480 = **saves 900 ops/day**

---

#### PAGE 2: Intelligence Center

**Route:** `/admin/intel`  
**Merges:** Intelligence + Regime + Sectors + Cache + Providers

**Tabs:**
- **Market** — Regime hero · RSI/BTC stats · Sector cards · Global metrics
- **Cache** — Cache group freshness (age-based, no hit/miss counters) · Quota bar · Worker status
- **Providers** — Unified provider table (8 rows) · Failover history

**Polling after consolidation:**
- Market data: 300s (was 120s for regime) — DB-only, no Redis impact
- Cache telemetry: 180s (was 60s) — saves 8 calls/hour × 12 Redis ops = 96 ops/hour
- Provider health: 180s (was 60s) — saves 2 calls/cycle × 3 ops = 6 ops/cycle

**Redis ops/day reduction:** 1,800 → 560 = **saves 1,240 ops/day**

---

#### PAGE 3: Analytics

**Route:** `/admin/analytics`  
**Merges:** Analytics + Calibration + Anomalies

**Tabs:**
- **Performance** — Edge verdict · Overall stats · Confidence bands · Intelligence performance
- **AI** — Claude toggle · AI call metrics · Verdict distribution · Cost breakdown
- **Anomalies** — Issues tiles · Anomaly feed · Detail drawer
- **Attribution** — Dimension tables · Pattern analysis · Daily report trigger

**Polling after consolidation:**
- Edge report: 300s (was 120s) — DB-only, no Redis impact
- Intelligence: 300s (was 120s) — DB-only
- Attribution: 600s (was 300s) — heavy query, rarely changes
- Anomalies: 180s (was 60s) — saves 80 ops/day

**Redis ops/day reduction:** 240 → 80 = **saves 160 ops/day**

---

#### PAGE 4: Settings (unchanged)

**Route:** `/admin/settings`  
Keep as-is. Pure DB, no Redis. No changes needed.

---

### Sidebar Navigation After Consolidation

```
TRADING DESK:   Trading Operations · Settings
INTELLIGENCE:   Intelligence Center
REVIEW:         Analytics
```

---

## SECTION B — SIGNAL METRICS CONSOLIDATION

### Duplicate Charts Between Calibration and Analytics

| Metric | Calibration | Analytics | Verdict |
|--------|-------------|-----------|---------|
| Edge Verdict (confidence, has_edge) | ✅ Top header | ✅ Top header | **EXACT DUPLICATE** — remove from Calibration, keep in Analytics tab |
| Overall Stats (WR, expectancy, Sharpe, profit_factor, max DD) | ✅ Bottom | ✅ Attribution tab | **EXACT DUPLICATE** — merge into Analytics → Performance tab |
| Confidence Calibration Bands | ✅ Live bars | ✅ Table view | Same data, different UI — keep one in Analytics → Performance |
| Intelligence Performance (best tier per dimension) | ✅ Section | ✅ Attribution section | **EXACT DUPLICATE** — keep only in Analytics → Attribution |
| Claude Validated / Heuristic count | ✅ Cards | ✅ Attribution breakdown | Keep AI tab in Analytics, remove from Calibration |
| AI Calls / Success Rate / Latency / Error | ✅ Calibration | ❌ Not in Analytics | Move to Analytics → AI tab |
| Verdict Distribution | ✅ Calibration | ❌ Not in Analytics | Move to Analytics → AI tab |

### Signal Quality Scorecard (replaces 3 separate sections)

Merge **confidence distribution + risk grade distribution + outcome distribution** into one `SignalQualityScorecard` component shown at the top of Analytics → Performance tab:

```
┌─────────────────────────────────────────────────────┐
│  SIGNAL QUALITY SCORECARD  (last 7d, n=1,247)       │
├──────────────┬──────────────┬───────────────────────┤
│  Confidence  │  Risk Grade  │  Outcome              │
│  90-94: 18%  │  A: 49%     │  TP Hit:  43%         │
│  80-89: 47%  │  B: 45%     │  SL Hit:  38%         │
│  70-79: 35%  │  C:  6%     │  Pending: 19%         │
├──────────────┴──────────────┴───────────────────────┤
│  Win Rate: 46.1%  Expectancy: +0.34R  Sharpe: 1.8   │
└─────────────────────────────────────────────────────┘
```

**Removes:** 3 separate chart components, 1 duplicate edge-verdict header, 2 duplicate stats tables.

---

## SECTION C — REDIS HOTSPOTS

### Full Key Inventory

| Key Pattern | Ops/Month | Memory | Business Value | Classification |
|-------------|-----------|--------|----------------|----------------|
| `celery:worker:last_heartbeat` | **~86,400** | <100 B | Railway health check — confirms worker alive | CRITICAL |
| `monitor:{date}:scans/signals/coins/tg/binance` | **~87,000** | <2 KB | Operational counters for dashboard | CRITICAL |
| `intel:quota:snapshot:{date}` | **~42,480** | <2 KB | CMC credit rolling history | OPTIONAL — over-written (fix O5) |
| `settings:generation` | **~43,200** | <50 B | Invalidation propagation across workers | CRITICAL — reduce check interval |
| `intel:quota:used/reset_at/minute_log` | **~56,160** | <1 KB | CMC quota guard | CRITICAL — correct by design |
| `cache:intel:{listings,trending,categories,global}` | **~30,000** | ~500 KB | CMC data for scanner | CRITICAL |
| `cache:intel:hits:*/misses:*` | **~31,680** | <200 B | Dashboard cosmetic counters | REMOVE |
| `scheduler:lock:{mode}` / `scheduler:enabled` | **~28,800** | <100 B | Distributed scan coordination | CRITICAL |
| `settings:d:{group}` / `settings:v:{group}` | **~9,000** | <10 KB | Settings cache (1h TTL, rarely missed) | CRITICAL |
| `monitor:scan_durations` (LIST) | **~14,400** | ~2 KB | Last 48 durations (list) | REMOVE — never read |
| `monitor:last_scan_duration_ms` | **~14,400** | <50 B | Last scan duration scalar | CRITICAL |
| `btc-4h-change` / `btc-regime` | **~7,600** | <100 B | BTC context for pipeline | CRITICAL |
| `futures:funding_trend:{symbol}` | **~7,200** | ~1 KB/symbol | Funding momentum (last 3 readings) | CRITICAL |
| `cache:funding-rate/open-interest/long-short:{symbol}` | **~6,000** | ~1 KB/symbol | Futures signal enrichment | CRITICAL |
| `scan:progress:{id}` / `scan:latest:{mode}` | **~14,400** | <5 KB | Scan progress for dashboard | OPTIONAL — reduce writes |
| `intel:fallback:status/alert/count` | **~200** | <200 B | CMC fallback visibility | CRITICAL (low volume) |
| `tg:alert:{symbol}:{direction}` | **~50** | <50 B | Telegram dedup (correctness) | CRITICAL |
| `scheduler:status_cache` | **~1,200** | <1 KB | 5s cache for status endpoint | CRITICAL — working |

### Code Locations for Changes

| Key | File | Line | Action |
|-----|------|------|--------|
| `cache:intel:hits:*` INCR | `backend/core/scanner/intelligence_cache.py` | 127, 173, 197 | Delete 3 lines |
| `cache:intel:hits:*` INCR | `lib/intelligence/workers.ts` | — | No TS writes found |
| `cache:intel:hits/misses:*` GET | `lib/intelligence/telemetry.ts` | 15–18 | Remove 2 of 3 keys per group |
| `monitor:scan_durations` LPUSH+LTRIM | `backend/analytics/monitoring.py` | 87–88 | Delete 2 lines |
| `intel:quota:snapshot:{today}` SET on every call | `backend/analytics/monitoring.py` | 189 | Gate behind hourly check |
| `settings:generation` check interval | `backend/system_settings/service.py` | 42 | `60.0 → 120.0` |
| Heartbeat schedule | `backend/workers/beat_schedule.py` | 82 | `60.0 → 120.0` |
| Health check no cache | `backend/api/health.py` | 20–77 | Add 90s in-process cache |

---

## SECTION D — PROVIDER HEALTH CONSOLIDATION

### Current State (scattered across 3 pages)

- **Overview page:** Provider status strip (3 compact cards: CMC, Binance, CoinGecko)
- **Providers page:** Full provider board (3 expanded cards), Ops summary (5 cells), Quota forecast
- **System page:** Service status grid (4 rows: Redis, DB, Celery, Binance)

### Target: Single Provider Table (in Intelligence Center → Providers tab)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PROVIDER HEALTH                                         Last updated: 12s ago │
├───────────────┬────────┬──────────┬───────────┬──────────────┬──────────────┤
│ Provider      │ Status │ Success% │ Latency   │ Last Success │ Fallback     │
├───────────────┼────────┼──────────┼───────────┼──────────────┼──────────────┤
│ Binance       │ ● OK   │  99.2%   │  142 ms   │  2s ago      │ —            │
│ CoinMarketCap │ ● OK   │  98.7%   │  890 ms   │  4m ago      │ —            │
│ CoinGecko     │ ● STBY │  —       │  —        │  3h ago      │ Standby      │
│ Claude Haiku  │ ● OK   │  94.1%   │  1.2 s    │  8m ago      │ Heuristic    │
│ Telegram      │ ● OK   │ 100.0%   │  310 ms   │  47m ago     │ —            │
│ Supabase      │ ● OK   │ 100.0%   │  23 ms    │  12s ago     │ —            │
│ Redis         │ ● OK   │ 100.0%   │  4 ms     │  12s ago     │ —            │
│ CloudAMQP     │ ● OK   │ 100.0%   │  —        │  60s ago     │ —            │
└───────────────┴────────┴──────────┴───────────┴──────────────┴──────────────┘
```

**Data sources for each row:**
- **Binance** — from `/api/admin/providers` response (existing)
- **CoinMarketCap** — from `intel:quota:*` + provider metrics (existing)
- **CoinGecko** — from provider metrics + `intel:fallback:status` (existing)
- **Claude Haiku** — from `ai_call_log` (24h success rate, last call)
- **Telegram** — from `monitor:{date}:telegram_sends` + last send timestamp
- **Supabase** — from `/health/ready` DB check
- **Redis** — from `/health/ready` PING status
- **CloudAMQP** — from Celery heartbeat freshness (`celery:worker:last_heartbeat` age)

**Poll interval:** 180s (was 60s on Providers page) — saves 3 ops × 40 fewer calls/day = 120 ops/day

**Removes:**
- Provider status strip from Overview (duplicate)
- Service status grid from System (move Redis/DB/Celery rows into this table)
- Duplicate Ops Summary section from Providers page

---

## SECTION E — INTELLIGENCE CENTER

### Current State (fragmented)

| Page | Shows | Redis Ops/Poll | Poll |
|------|-------|----------------|------|
| Cache | 4 groups + hit/miss % + quota | 12 | 60s |
| Providers | CMC quota, failover | 3 | 60s |
| Intelligence | CMC trending, categories | 0 | manual |
| Overview | Cache status strip | 2 | 60s |

### Target: Intelligence Center → Cache tab

**Display (age-based, no counters):**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  INTELLIGENCE CACHE                               Quota: 1,247/300K credits │
├─────────────────────┬────────┬──────────┬────────────────┬──────────────────┤
│ Group               │ Status │ Age      │ TTL            │ Last Refresh     │
├─────────────────────┼────────┼──────────┼────────────────┼──────────────────┤
│ Listings (100 coins)│ ● FRESH│ 2m 14s   │ 5 min          │ 12:31:46         │
│ Categories          │ ● FRESH│ 18m 03s  │ 30 min         │ 12:15:57         │
│ Global Metrics      │ ● FRESH│ 6m 22s   │ 10 min         │ 12:27:38         │
│ Trending (20 coins) │ ⚠ STALE│ 11m 44s  │ 10 min         │ 12:22:16         │
├─────────────────────┴────────┴──────────┴────────────────┴──────────────────┤
│  Workers: listings ● · global ● · trending ● · categories ●                │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Remove completely:**
- `hitCount`, `missCount`, `hitRate` fields from `CacheGroupMeta` type
- `groupHitsKey()`, `groupMissesKey()` exports from `cache-groups.ts`
- `redis.get(groupHitsKey(name))` and `redis.get(groupMissesKey(name))` from `telemetry.ts`
- `await redis.incr(INTEL_HITS_KEY)` from `intelligence_cache.py` lines 127, 173, 197

**Keep:**
- `ageSeconds`, `isStale`, `lastRefreshedAt` (computed from data key's `refreshedAt` field)
- Quota usage bar
- Worker status dots

**Redis ops/poll reduction:** 12 → 4 (one GET per group for data only)  
**At 180s poll, 2h/day:** 40 polls × 4 ops = 160 ops/day (was 120 polls × 12 = 1,440 ops/day)

---

## SECTION F — CLOUDAMQP AUDIT

### Current Message Volume

| Task | Schedule | Messages/Day | Messages/Month | % of Total |
|------|----------|-------------|----------------|------------|
| `worker-heartbeat` | every 60s | **1,440** | 43,200 | **77.8%** |
| `auto-scan-standard` | every 15m | 96 | 2,880 | 5.2% |
| `auto-scan-high-confidence` | every 30m | 48 | 1,440 | 2.6% |
| `auto-scan-futures` | every 30m | 48 | 1,440 | 2.6% |
| `auto-scan-trending` | every 30m | 48 | 1,440 | 2.6% |
| `check-signal-outcomes` | every 10m | 144 | 4,320 | 7.8% |
| `hourly-anomaly-check` | every 1h | 24 | 720 | 1.3% |
| `daily-analytics-snapshot` | 1×/day | 1 | 30 | <0.1% |
| `refresh-daily-view` | 1×/day | 1 | 30 | <0.1% |
| **TOTAL** | | **1,850** | **55,500** | 100% |

Little Lemur limit: **1,000,000 messages/month** — currently 5.6% used. No urgency, but heartbeat dominates unnecessarily.

### Safe Reductions

| Task | Current | Proposed | Rationale | Messages/Day Saved |
|------|---------|----------|-----------|-------------------|
| `worker-heartbeat` | 60s | **120s** | TTL is 300s; 2-min interval gives 2.5× safety margin | **720** |
| `check-signal-outcomes` | 10m | **15m** | Align with standard scan cadence; outcome resolution is eventual-consistent | **48** |
| `hourly-anomaly-check` | every 1h | **every 4h** | Anomalies evolve over hours; 4× daily still actionable | **18** |

**After reductions:**

| | Before | After | Change |
|-|--------|-------|--------|
| Messages/day | 1,850 | 1,064 | −786 (−42.5%) |
| Messages/month | 55,500 | 31,920 | **−23,580 (−42.5%)** ✅ |

**Unsafe (do not change):**
- Scan tasks: scan cadence is the product's core frequency — do not slow down
- `daily-analytics-snapshot`: timing-dependent (23:59 UTC) — do not change
- `refresh-daily-view`: depends on midnight data landing — do not change

---

## SECTION G — BROKEN METRICS

### Metrics That Exist, Are Collected, But Are Never Used

| Metric | Written By | Read By | Storage Cost | Removal Safety |
|--------|-----------|---------|-------------|----------------|
| `monitor:scan_durations` (LIST, last 48) | `monitoring.py:87–88` lpush+ltrim | **Nothing** | ~2 KB Redis + 2 ops/scan = 480 ops/day | **100% safe — delete** |
| `cache:intel:hits:{group}` | `intelligence_cache.py:127,173,197` | `telemetry.ts` dashboard only | ~50 B + 336 ops/day | Safe — Prometheus records same data |
| `cache:intel:misses:{group}` | `intelligence_cache.py` fallback path | `telemetry.ts` dashboard only | ~50 B + ~5 ops/day | Safe — shown as 0% anyway |
| `scheduler:state` (constant) | Defined, never written | Never read | 0 (just code) | Safe — dead constant, delete |
| `intel:quota:snapshot:{today}` over-write | `monitoring.py:189` every monitor call | `monitoring.py:195` (1 read/call) | ~50 B × 7-day window + **1,440 writes/day** | Safe to gate to hourly |

### Total Ops/Month from Broken Metrics

| Metric | Ops/Month | Action |
|--------|-----------|--------|
| `monitor:scan_durations` | 14,400 | Delete lines 87–88 |
| `cache:intel:hits/misses:*` INCRs | 10,200 | Delete INCR calls |
| `intel:quota:snapshot` over-write | 42,480 | Gate to hourly write |
| **Total** | **67,080** | All three are <5 LOC each |

---

## SECTION H — POLLING OPTIMIZATION

### Current vs Proposed Intervals

| Page → New Page | Endpoint | Current | Proposed | Rationale |
|-----------------|----------|---------|----------|-----------|
| System → Trading Ops Monitor tab | `/api/analytics/monitor` | 60s | **180s** | Counters change on scan completion (~15min cadence); 3× slower is fine |
| System → Trading Ops | `/api/health/ready` | 120s | **300s** | Health flips on outages, not gradual change; 5min polling still operationally useful |
| Scanner → Trading Ops | `/api/scheduler/status` | 60s | **120s** | Scan state changes on 15-30min cycle; 2-min polling is sufficient |
| Overview → Trading Ops | All overview endpoints | 60s | **180s** | Overview is summary; not action-driving |
| Cache → Intel Center | `/api/cache/intelligence/telemetry` | 60s | **180s** | Cache TTLs are 5–30 min; 60s granularity adds no value |
| Providers → Intel Center | `/api/admin/providers` | 60s | **180s** | Provider health flips slowly; 3-min polling is fine |
| Anomalies → Analytics | `/api/admin/burnin/anomalies` | 60s | **180s** | Anomalies accumulate slowly |
| Signals | `/api/signals` | 60s | **120s** | DB-only; signals generated every 15min; fine at 2min |

### Shared Polling Layer

For pages with multiple endpoints at the same interval, create a single `useDashboardData()` hook that:
1. Fetches all required endpoints in parallel (`Promise.all`)
2. Returns merged data to all consumers
3. Runs on a single timer

**Example: Trading Operations Live tab** — instead of 3 separate `useAutoRefresh` calls (scheduler, monitor, health) each at different intervals, one `useAutoRefresh(fetchDashboard, 180_000)` that does a parallel `Promise.all` and returns all three.

**Benefit:** 3 → 1 timer per page. Eliminates cases where overlapping timers fire at different times, doubling API calls.

### Dashboard API Calls/Day Impact

| Scenario | Current | Proposed |
|----------|---------|----------|
| Trading Ops (monitor 60s → 180s, 2h/day) | 120 calls × 9 Redis ops = 1,080 | 40 calls × 9 ops = 360 |
| Intel Center (cache 60s → 180s, 2h/day) | 120 calls × 12 ops = 1,440 | 40 calls × 4 ops = 160 |
| Providers (60s → 180s, 2h/day) | 120 calls × 3 ops = 360 | 40 calls × 3 ops = 120 |
| System health (120s → 300s, 2h/day) | 60 calls × 2 ops = 120 | 24 calls × 2 ops = 48 |
| **Total dashboard Redis ops/day** | **3,000** | **688** |
| **Monthly (30-day)** | 90,000 | 20,640 |
| **Reduction** | | **−69,360 (−77%)** ✅ |

---

## SECTION I — REDIS REMOVAL PLAN

### P0 — No UX impact, 1–2 line changes (implement first)

| ID | Change | File | Line(s) | Ops/Day Saved | Ops/Month Saved | Risk |
|----|--------|------|---------|---------------|-----------------|------|
| **R1** | Delete `monitor:scan_durations` lpush+ltrim | `backend/analytics/monitoring.py` | 87–88 | 480 | 14,400 | Zero |
| **R2** | Heartbeat interval `60.0 → 120.0` | `backend/workers/beat_schedule.py` | 82 | 720 SETs + 720 AMQP | 21,600 | Very low |
| **R3** | Settings gen check `60.0 → 120.0` | `backend/system_settings/service.py` | 42 | 720 | 21,600 | Very low |
| **R4** | Quota snapshot write: hourly guard | `backend/analytics/monitoring.py` | 189 | 1,416 | 42,480 | Zero |
| **R5** | Skip EXPIRE in `_incr()` after day-init | `backend/analytics/monitoring.py` | 36–43 | 526 | 15,780 | Very low |

**P0 total: ~3,862 ops/day → saves 115,860 ops/month → 430K → ~314K**

---

### P1 — Small change, clear payoff

| ID | Change | File | Line(s) | Ops/Day Saved | Ops/Month Saved | Risk |
|----|--------|------|---------|---------------|-----------------|------|
| **R6** | Cache `/health/ready` result in-process (90s TTL) | `backend/api/health.py` | 20–77 | ~1,440 | ~43,200 | Low |
| **R7** | Polling intervals: monitoring 60s → 180s, cache 60s → 180s | `system/page.tsx`, `cache/page.tsx` | useAutoRefresh | ~2,000 | ~60,000 | Very low |

**P1 total: ~3,440 ops/day → saves ~103,200 ops/month → 314K → ~211K**

---

### P2 — Requires UI update (cache page hit/miss removal)

| ID | Change | Files | Ops/Day Saved | Ops/Month Saved | Risk |
|----|--------|-------|---------------|-----------------|------|
| **R8** | Remove intelligence hit/miss Redis counters + telemetry reads | `intelligence_cache.py`, `telemetry.ts`, `cache-groups.ts`, `cache/page.tsx` | 1,056 | 31,680 | Low — cache page shows age instead of hit rate |
| **R9** | Polling consolidation (further intervals + shared layer) | Multiple admin pages | 500 | 15,000 | Very low |

**P2 total: ~1,556 ops/day → saves ~46,680 ops/month → 211K → ~164K ✅ Under 200K**

---

### CloudAMQP Beat Schedule Changes

| ID | Change | File | Line | AMQP Msgs/Month Saved | Risk |
|----|--------|------|------|----------------------|------|
| **A1** | Heartbeat `60.0 → 120.0` s (same as R2) | `beat_schedule.py` | 82 | 21,600 | Very low |
| **A2** | Outcomes check `*/10 → */15` | `beat_schedule.py` | 52 | 1,440 | Very low |
| **A3** | Anomaly check every 1h → every 4h | `beat_schedule.py` | 68–70 | 540 | Low |

**Total AMQP savings: 23,580 msgs/month → 55,500 → 31,920**

---

## SECTION J — FINAL SCORECARD

### Redis

| Metric | Current | After P0+P1 | After P0+P1+P2 |
|--------|---------|-------------|-----------------|
| Ops/month | ~430,000 | ~211,000 | **~164,000** |
| Ops/day | ~14,333 | ~7,033 | ~5,467 |
| % reduction | — | 51% | **62%** |

### CloudAMQP

| Metric | Current | After A1+A2+A3 |
|--------|---------|-----------------|
| Messages/month | 55,500 | **31,920** |
| Messages/day | 1,850 | 1,064 |
| % reduction | — | **42.5%** |

### Dashboard API Calls

| Metric | Current (2h/day active) | After Consolidation + Polling |
|--------|------------------------|-------------------------------|
| Redis-touching API calls/day | ~300 calls | ~120 calls |
| Redis ops from dashboard/day | ~3,000 | ~688 |
| Total admin pages | 13 | 3 (+Settings) |
| % Redis reduction from dashboard | — | **77%** |

### Top 20 Waste Sources (Ranked by Ops/Month)

| # | Source | Ops/Month | Fix |
|---|--------|-----------|-----|
| 1 | Railway `/health/ready` PING+GET every ~60s | ~86,400 | R6 |
| 2 | CMC quota `consume()` pipeline per worker tick | ~56,160 | Correct behaviour — no change |
| 3 | Monitor dashboard reads (9 ops × 60s) | ~50,400 | R7 (interval) |
| 4 | `monitor:scan_durations` list writes | ~43,200 (write only) | R1 (delete) |
| 5 | `intel:quota:snapshot` SET every monitor call | ~42,480 | R4 (hourly) |
| 6 | Worker heartbeat SETEX every 60s | ~43,200 | R2 |
| 7 | Settings gen check GET every 60s | ~43,200 | R3 |
| 8 | Cache telemetry 12 ops × 60s | ~40,500 | R7+R8 |
| 9 | `monitor:{date}:*` EXPIRE on every INCR | ~15,780 | R5 |
| 10 | Intelligence hit/miss INCRs | ~10,200 | R8 |
| 11 | Intelligence hit/miss GETs (telemetry) | ~21,480 | R8 |
| 12 | Scheduler lock ops | ~28,800 | No change — required |
| 13 | Scan progress/latest writes | ~14,400 | No change — used |
| 14 | CMC cache intel reads | ~30,000 | No change — required |
| 15 | Futures cache ops | ~30,000 | No change — required |
| 16 | Settings Redis reads (cache miss) | ~9,000 | No change — rare |
| 17 | BTC regime cache | ~7,600 | No change — required |
| 18 | Futures funding trend | ~7,200 | No change — required |
| 19 | Provider polling ops | ~10,800 | R7 (interval) |
| 20 | Anomaly/burnin polling | ~7,200 | R7 (interval) |

### GO / NO-GO

**OPS.CONSOLIDATION.1: GO ✅**

| Section | Verdict | Notes |
|---------|---------|-------|
| Section A — Dashboard consolidation | **GO** | 13 → 3 pages; no signal logic touched |
| Section B — Signal Quality Scorecard | **GO** | Removes duplicates; no data loss |
| Section C — Redis hotspots (code changes) | **GO P0/P1** | Conservative; no correctness risk |
| Section D — Provider table | **GO** | Pure UI consolidation |
| Section E — Intelligence Center | **GO** | Remove cosmetic counters only |
| Section F — CloudAMQP reductions | **GO** (A1+A2 only) | A3 (anomaly 4h): conditional |
| Section G — Broken metrics removal | **GO** | All identified items are dead writes |
| Section H — Polling optimization | **GO** | Intervals match data change frequency |
| Section I — P0+P1 Redis removals | **GO** | 7 changes, all <10 LOC, all reversible |
| Section I — P2 UI update (hit/miss) | **GO** | Low risk; age-based display is superior |

**BLOCK items (do not proceed):**
- Reducing standard scan frequency — core product cadence
- Caching `AISettings` without pub/sub invalidation — emergency stop must propagate
- Removing `tg:alert:*` keys — correctness guarantee for Telegram dedup
- Removing `scheduler:lock:*` — distributed correctness

---

## Implementation Order

```
BATCH 1 — P0 one-liners (R1, R2, R3, R4, R5)         → ~115K ops/month saved
BATCH 2 — Health cache + polling (R6, R7)             → ~103K ops/month saved
BATCH 3 — CloudAMQP reductions (A1, A2, A3)           → ~23K msgs/month saved
BATCH 4 — Hit/miss removal + UI (R8, R9)              → ~47K ops/month saved
BATCH 5 — Dashboard consolidation (3-page nav)        → UX + ~69K ops/month saved
BATCH 6 — Provider table + Signal Quality Scorecard   → UX clean-up
```

*See `docs/REDIS_OPTIMIZATION_AUDIT.md` for fix tracking table (O1–O7). This document supersedes it for batches 4–6.*

---

*Generated: Phase OPS.CONSOLIDATION.1 audit — 2026-06-09*  
*Related: `docs/REDIS_OPTIMIZATION_AUDIT.md` · `docs/PRODUCTION_READINESS_AUDIT.md`*
