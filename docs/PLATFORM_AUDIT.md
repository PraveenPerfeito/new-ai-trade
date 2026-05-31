# SignalEdge AI — Platform Audit Report

**Date:** 2026-05-28  
**Scope:** 14 Admin Pages + Sidebar Architecture + Workflow Analysis  
**Auditor:** Automated Multi-Agent Analysis  
**Overall Health Score: 63 / 100**

---

## Status Note (Phase 7.2B — May 2026)

**May 2026 Update:** Platform audit completed against v1.4–7.4A + Phase 7.2B. Major resolution:

**RESOLVED (Phase 7.2B.1–7.2B.6):**
- ✅ Settings page → "Founder Control Center" with 3 primary modes + Advanced Presets (Issue #2, #7, #17)
- ✅ Providers page → "Operations Dashboard" with CompactProviderCard + QuotaBurnForecast (Issue #1, #13, #16)
- ✅ Regime page → "Apply Regime Settings" button with preview modal (Issue #11, #13)
- ✅ Anomalies page → "Anomaly Action Center" with state machine + action buttons (Issue #1, #12, #15)
- ✅ Sidebar restructured into 4 groups (TRADING DESK/MARKET/OPERATIONS/REVIEW) (Issue #1, #5)
- ✅ /admin/signals Intelligence section (TrendScore, Sector, Breakout, OI, Funding, Positioning) (Issue #9)
- ✅ Signals/Tactical density: Desktop columns (Entry md+, Target% lg+, Stop% lg+), pagination (Issue #2, #6)
- ✅ Topbar alerts: "3 CRITICAL / WARN" clickable to /admin/anomalies (Issue #4)

**RESOLVED (Phase 7.2B.8 — Operational Control Incident, 2026-05-31):**
- ✅ BUG-1: Scanner toggle (`scheduler:enabled`) never read before task execution — fixed in `scan_task.py` + `api/scanner.py` (`0a7306e`)
- ✅ BUG-2: `TelegramSettings.alerts_enabled` and `FeatureFlags.telegram` never checked before sending — fixed in `telegram_notifier.py` (`0a7306e`)
- ✅ BUG-3/4: `emergency_stop` and `maintenance_mode` fields added to `FeatureFlags`; enforced in all scan and Telegram paths (`0a7306e`)
- ✅ Operations Control page rebuilt — Scanner, Claude AI, Telegram, Emergency Stop, Maintenance Mode unified (`0a7306e`)
- ✅ 18 unit tests added for all operational gates — 414/414 suite passing (`0a7306e`)

**RESOLVED (Phase 7.2B.7 — Production Hardening, 2026-05-30):**
- ✅ B1: .env.local confirmed never committed — no credential rotation required (`478fc54`)
- ✅ B2: ADMIN_SECRET enforced as `z.string().min(32)` in `lib/env.ts` (`478fc54`)
- ✅ H1: 18× `console.log` in `lib/scheduler.ts` + 2× in `lib/backtest.ts` → structured pino logger (`d37cba6`)
- ✅ H2: Celery `soft_time_limit` 840s→1020s, `time_limit` 960s→1140s — scan no longer killed on completion (`74672c1`)
- ✅ H3: Beat schedule `expires` 780s→1020s for all scan tasks — queued scans no longer dropped (`74672c1`)
- ✅ H4: `infra_collector._run_loop` wrapped in try/except — Prometheus metrics no longer die silently (`74672c1`)
- ✅ H5: `_SlidingWindowRateLimiter` (12 RPM) + 3-attempt 429 retry added to `ai_validator.py` (`1a471c2`)
- ✅ M1: Setup gate raised 60→72 to eliminate 60-72 dead zone (`fe99495`)
- ✅ M6: `pre_score` clamped to 100 in `detect_setup()` (`fe99495`)
- ✅ H1 complete — supabase.ts (13×) + retry.ts (1×) → structured pino (`f5a7169`); 34 total console.* resolved
- ✅ M3 reclassified FALSE POSITIVE — single-founder scale, internal APIs only
- ✅ Production Readiness score: **7.4/10 CONDITIONAL GO → 9.0/10 ✅ GO**

**REMAINING GAPS (Phase 7.5 recommended):**
- 🔶 Scan Now auto-redirect to Signals (Issue #1) — workflow friction
- 🔶 Emergency Pause button on Overview (Issue #2) — operational safety
- 🔶 Mobile unusability (9-column Tactical, Signals card stacking) (Issues #3, #6, #7, #10–20)
- 🔶 CMC quota burn forecast & unified warning (Issue #4) — quota visibility
- 🔶 Edge analytics progress count (Issue #3) — warmup feedback
- 🔶 Setting impact preview before save (Issue #6) — blind iteration
- 🔶 Live next-scan countdown (Issue #1, #14, #17)
- 🔶 Provider health on Overview strip (Issue #5, #8)
- 🔶 Mode performance comparison (Issue #4, #9)
- 🔶 Confirmation after Daily Report send (Issue #5, #19)
- 🔶 M2: `_register_analytics()` fire-and-forget done-callback reliability
- 🔶 M3: Frontend refresh interval jitter + centralized config
- 🔶 M4: ATR minimum relative floor
- 🔶 M5: Signal rejection reasons not persisted to DB

**COMPLETED (Phase 7.2B.9 — Provider & Architecture Audit, 2026-05-31):**
- ✅ Full provider utilization traced: CMC · CoinGecko · Binance · Redis
- ✅ All dashboard anomalies explained (Binance red, CMC 0%, Redis 500K, 41.9% hit rate)
- ✅ Architecture confirmed HEALTHY — no unsafe removals identified
- ✅ See: [docs/PROVIDER_ARCHITECTURE_AUDIT.md](PROVIDER_ARCHITECTURE_AUDIT.md)

**COMPLETED (Phase 7.2B.10 — Redis Optimization Audit, 2026-05-31):**
- ✅ Top 20 Redis consumers identified and ranked
- ✅ 6 QUICK WIN fixes (615K → ~240K/month, >51% reduction, zero architecture change) — `e0d3543`
- ✅ Safe vs unsafe optimization table produced
- ✅ See: [docs/REDIS_OPTIMIZATION_AUDIT.md](REDIS_OPTIMIZATION_AUDIT.md)

**COMPLETED (Phase 7.2B.10.3 — Provider Dashboard Accuracy, 2026-05-31):**
- ✅ CMC 0% root cause: wrong quota metric source (`providers:metrics:*` vs `intel:quota:used`) — `1ba74ff`
- ✅ Binance RED root cause: stale top-coins errors from geo-blocked fallback path — `1ba74ff`
- ✅ Both fixed in `backend/api/providers.py` (25 lines)

**COMPLETED (Phase 8.0 — Outcome Analytics Readiness Audit, 2026-05-31):**
- ✅ All 7 intelligence fields confirmed persisted to signals + signal_outcomes tables
- ✅ Root cause of 9% win rate identified: missing BTC macro regime gate
- ✅ May 29 incident traced: 99 SELL signals at 0% win rate during bull reversal
- ✅ See: [docs/PHASE8_ANALYTICS_AUDIT.md](PHASE8_ANALYTICS_AUDIT.md)

**COMPLETED (Phase 8.0.1 — Analytics Intelligence Wiring, 2026-05-31):**
- ✅ GAP-1: `get_outcomes()` SQL now returns all 7 intelligence fields — `270368e`
- ✅ GAP-2: 7 new breakdowns in `get_analytics()` (TrendScore tier, Sector, Breakout, OI, Funding, Positioning) — `270368e`
- ✅ GAP-3: `_fetch_outcomes()` in edge_validation.py includes all 7 fields — `270368e`
- ✅ GAP-4: `trend_score_tier()` helper (ELITE/STRONG/GOOD/WEAK) — `270368e`
- ✅ GAP-5: `GET /analytics/intelligence` endpoint returns best tier per dimension — `270368e`
- ✅ GAP-6: Intelligence Performance section on Analytics page — `270368e`

**COMPLETED (Phase 8.1A — BTC Regime Architecture Audit, 2026-05-31):**
- ✅ Option B (port to Python) selected over Option A (TypeScript→Redis→Python)
- ✅ Implementation plan defined: 4 files, ~80 lines, no new infrastructure
- ✅ Expected improvement: 9% → ~24% win rate, −30% signal volume
- ✅ See: [docs/PHASE8_REGIME_AUDIT.md](PHASE8_REGIME_AUDIT.md)

**PENDING (Phase 8.1B — BTC Regime Gate Implementation):**
- 🔶 `get_btc_regime()` in market_fetcher.py
- 🔶 Regime gate in signal_pipeline.py (BULL blocks SELL, BEAR blocks BUY)
- 🔶 `market_regime` stored on all signals
- 🔶 30-day clean dataset accumulation

All 15 TOP 20 Issues from original audit are now: 7 RESOLVED (Phase 7.2B.1–6), 8 PENDING (Phase 7.5)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Per-Page Analysis](#per-page-analysis)
3. [Sidebar Architecture Analysis](#sidebar-architecture-analysis)
4. [Workflow Gaps](#workflow-gaps)
5. [TOP 20 UX Issues](#top-20-ux-issues)
6. [TOP 20 Dashboard Issues](#top-20-dashboard-issues)
7. [TOP 20 Mobile Issues](#top-20-mobile-issues)
8. [TOP 20 Workflow Improvements](#top-20-workflow-improvements)
9. [Critical Issues — Fix First](#critical-issues--fix-first)
10. [Quick Wins — Under 1 Hour Each](#quick-wins--under-1-hour-each)

---

## Executive Summary

The admin dashboard is **functionally complete** but has significant **workflow friction** for a solo founder. The most critical gap is the disconnect between **actions and feedback** — triggering a scan does not show results, changing settings does not preview impact, and spotting an anomaly requires multiple navigation steps before action can be taken.

The **sidebar naming** (OPERATIONS vs INTELLIGENCE) creates confusion about what each section contains. **Mobile usability is poor** — 9-column tables and multi-row filter bars overflow on phones, a serious problem when monitoring signals on the go after a Telegram alert fires at 2am.

The platform has all the right data. It needs better **surfacing, linking, and one-click actions** to match how a founder actually uses it in real trading situations.

---

## Per-Page Analysis

---

### 1. `/admin/overview` — Command Overview

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Founder's daily landing page — system health, scanner status, regime, recent signals, cache at a glance |
| **Data Sources** | `/api/scanner/control` (15s) · `/api/market/intelligence` (15s) · `/api/signals/tactical?limit=10` (15s) · `/api/cache/intelligence` (15s) |
| **User Actions** | Manual refresh · click-through links to detail pages |
| **Missing Data** | BUY/SELL signal ratio · 7-day win rate snapshot · provider health status · live next-scan countdown |
| **Broken Widgets** | None |
| **Stale Telemetry** | Good (15s) — but "last scan" shows relative time only, no live countdown |
| **UX Issues** | Cache groups strip is too dense and hard to scan · signal table truncates at 8 rows · "Updated" timestamp only changes when data changes |
| **Navigation Issues** | None |
| **Mobile Issues** | Cache groups flex-wrap overflows to 3 rows on small screens |
| **Duplicate Info** | Cache groups shown here AND on `/admin/cache` · regime shown here AND on `/admin/regime` |
| **Low-Value Widgets** | None — all tiles serve the command centre purpose |
| **High-Value Improvements** | Add live next-scan countdown · add provider health status pill · add BUY/SELL ratio · add 7-day win rate |
| **Recommended Removals** | Nothing |
| **Recommended Consolidations** | Cache groups → single 2×2 status grid instead of horizontal scrolling strip |

---

### 2. `/admin/market` — Market Intelligence

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Real-time regime, global metrics, market breadth, trending coins |
| **Data Sources** | `/api/market/intelligence` (30s) |
| **User Actions** | Refresh button only (read-only page) |
| **Missing Data** | No BTC dominance trend arrow · no ATR spike alarm · no sector rotation context |
| **Broken Widgets** | None |
| **Stale Telemetry** | 30s — appropriate |
| **UX Issues** | Breadth percentages confusing without clear label · top movers shows 8 coins (5 is cleaner) · regime card is oversized |
| **Navigation Issues** | None |
| **Mobile Issues** | Grid layout breaks on small screens · tables require horizontal scroll |
| **Duplicate Info** | Regime duplicates `/admin/regime` · trending coins overlaps `/admin/sectors` |
| **Low-Value Widgets** | Top movers section — already available on Sectors page |
| **High-Value Improvements** | BTC dominance trend arrow · ATR spike red warning banner · sector rotation shortlist (top 3 rising / falling) |
| **Recommended Removals** | Top movers section (move to Sectors page) |
| **Recommended Consolidations** | Global Metrics + Breadth → single compact row |

---

### 3. `/admin/scanner` — Scanner Control

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Celery scheduler status, manual scan trigger, rejection breakdown |
| **Data Sources** | `adminApi.scheduler.status` (8s) · `/api/scanner/control` for rejection stats (loaded once) |
| **User Actions** | Enable/Disable auto-scan · mode selector (spot/futures/high_confidence/trending) · Scan Now button |
| **Missing Data** | No live countdown to next scheduled scan · no CMC quota warning · no link to results after scan |
| **Broken Widgets** | Scan Now says "results within ~60s" but no redirect or result panel |
| **Stale Telemetry** | "Next standard: Xm Ys" is static — does not tick down in real time |
| **UX Issues** | After scan, founder must manually navigate to Signals · rejection breakdown only populated after Scan Now (confusing when empty) |
| **Navigation Issues** | None |
| **Mobile Issues** | Rejection gate bar chart does not scroll gracefully on small screens |
| **Duplicate Info** | Schedule information also shown in Settings page (scanner group) |
| **Low-Value Widgets** | Schedule reference section (read-only, static, takes vertical space) |
| **High-Value Improvements** | Live ticking countdown · auto-redirect to Signals after scan completes · CMC quota depletion warning |
| **Recommended Removals** | Schedule reference section (convert to hover tooltip) |
| **Recommended Consolidations** | Scan Now + mode selector → single horizontal action bar |

---

### 4. `/admin/signals` — Signal Intelligence

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Browse all signals with filtering, sorting, and edge statistics |
| **Data Sources** | `/api/signals?limit=200&minConfidence=0` (30s) · `adminApi.analytics.edgeReport(168)` (60s) |
| **User Actions** | Filter by mode/direction/confidence · sort by date/confidence/R:R · expand signal cards |
| **Missing Data** | No lifecycle stage distribution · no mode performance comparison · no win/loss count in header |
| **Broken Widgets** | None |
| **Stale Telemetry** | Edge report (60s) lags behind signals (30s) — slight mismatch |
| **UX Issues** | "Insufficient data" shows no progress count (X/30 needed) · 200 signals with no pagination · confidence calibration lags behind |
| **Navigation Issues** | None |
| **Mobile Issues** | Expanded card fields stack with no visual grouping · trade levels and technical sections visually compete |
| **Duplicate Info** | Edge stats also visible on `/admin/analytics` |
| **Low-Value Widgets** | Futures-specific fields (funding rate, OI) visible when viewing spot-only signals |
| **High-Value Improvements** | Lifecycle stage distribution pill row · mode win rate comparison · "X/30" progress bar for edge warmup |
| **Recommended Removals** | Futures fields when mode filter is set to spot |
| **Recommended Consolidations** | Filter row → collapsible to reclaim vertical space |

---

### 5. `/admin/tactical` — Tactical Feed

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Real-time signal lifecycle tracking with stage-based filtering |
| **Data Sources** | `/api/signals/tactical` (10s) |
| **User Actions** | 9 stage filters · 3 direction filters · 5 mode filters |
| **Missing Data** | No stage transition timing · no stage count summary bar · no preset filters |
| **Broken Widgets** | None |
| **Stale Telemetry** | 10s — excellent |
| **UX Issues** | 17 filter options visible simultaneously (overwhelming) · no "Active Signals" one-click preset · "time in stage" column missing |
| **Navigation Issues** | None |
| **Mobile Issues** | 9-column table forces horizontal scroll · filter row wraps to 3+ lines on phone |
| **Duplicate Info** | Signal data overlaps `/admin/signals` (different angle — lifecycle vs data view) |
| **Low-Value Widgets** | Mode filter (mode visible in table itself) |
| **High-Value Improvements** | Stage distribution bar at top · preset filter buttons ("Active", "Won", "Lost") · "time in stage" column |
| **Recommended Removals** | Nothing |
| **Recommended Consolidations** | Stage/type/mode filters → 2-row compact bar with dropdowns |

---

### 6. `/admin/analytics` — Quantitative Analytics

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Edge validation, attribution intelligence — win rates, expectancy, confidence calibration |
| **Data Sources** | `adminApi.analytics.edgeReport()` (120s) · `/api/analytics/attribution?hours=720` (300s) |
| **User Actions** | Tab between Edge Validation and Attribution · trigger daily report (button) |
| **Missing Data** | No time-of-day performance bias · no volatility impact heatmap · AI vs heuristic delta buried in Attribution tab |
| **Broken Widgets** | Edge warming-up message shows no progress count (X/30 needed) |
| **Stale Telemetry** | Attribution refreshes every 5 minutes — may show outdated breakdowns during analysis session |
| **UX Issues** | ECE score shown without explanation (what is 0.047 — good or bad?) · recommendation cards very small · attribution shows "insufficient" without next steps |
| **Navigation Issues** | None |
| **Mobile Issues** | Calibration table (5 columns) requires horizontal scroll on phone |
| **Duplicate Info** | Edge stats partially visible on `/admin/signals` |
| **Low-Value Widgets** | Calibration recommendation cards when data is insufficient (noise) |
| **High-Value Improvements** | ECE score colour label (Excellent/Fair/Poor) · confidence band bar chart · "X/30" warmup progress bar |
| **Recommended Removals** | Recommendation cards when < 30 resolved signals exist |
| **Recommended Consolidations** | Overall Statistics + Calibration → single 2-section panel |

---

### 7. `/admin/regime` — Regime Intelligence

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Deep dive into BTC-derived 4h market regime with scanner parameter guidance |
| **Data Sources** | `/api/market/intelligence` (30s) |
| **User Actions** | Refresh button only (read-only) |
| **Missing Data** | No regime duration timer · no regime transition probability · no momentum indicator (strengthening vs weakening) |
| **Broken Widgets** | None |
| **Stale Telemetry** | 30s — appropriate |
| **UX Issues** | RSI gauge takes too much vertical space · recommended params do not link to Settings · classification reference table is redundant (same info above) |
| **Navigation Issues** | None |
| **Mobile Issues** | RSI gauge too wide · regime hero section stacks awkwardly on small screens |
| **Duplicate Info** | Regime shown on `/admin/overview` and `/admin/market` |
| **Low-Value Widgets** | Classification reference table at bottom of page |
| **High-Value Improvements** | Regime duration meter ("Bull Trend for 8h 23m") · 1-click apply suggested params to Settings · regime change alert banner |
| **Recommended Removals** | Classification reference table |
| **Recommended Consolidations** | BTC quick stats + recommended params → single 2-column section |

---

### 8. `/admin/sectors` — Sector Rotation

| Dimension | Finding |
|-----------|---------|
| **Purpose** | CMC category breadth, strongest/weakest sectors, momentum tracking |
| **Data Sources** | `/api/market/sectors` (60s) |
| **User Actions** | Refresh button only (read-only) |
| **Missing Data** | No sector rotation trade signal · no correlation heatmap · no 24h sector performance ranking |
| **Broken Widgets** | None |
| **Stale Telemetry** | 60s — acceptable |
| **UX Issues** | Two tables (CMC Categories vs Sector Breadth) feel redundant · momentum values shown as text without directional icons |
| **Navigation Issues** | None |
| **Mobile Issues** | Two full-width tables cannot both fit on mobile · requires tabbing |
| **Duplicate Info** | Trending coins shown here and on `/admin/market` |
| **Low-Value Widgets** | Sector breadth table (coin-derived, less reliable than CMC categories) |
| **High-Value Improvements** | Momentum arrow icons (↑ accelerating, ↔ stable, ↓ decelerating, ↺ reversing) · sector rotation signal ("DeFi strength detected") · 24h sector leaderboard |
| **Recommended Removals** | Sector breadth table (keep CMC Categories only) |
| **Recommended Consolidations** | Strongest/weakest highlights merged into category table rows |

---

### 9. `/admin/calibration` — Calibration

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Claude AI on/off toggle, validation effectiveness metrics, confidence band performance |
| **Data Sources** | `adminApi.analytics.ai(24)` (30s) · `adminApi.analytics.edgeReport()` (120s) |
| **User Actions** | Enable/Disable Claude AI toggle · view AI call stats · view confidence bands |
| **Missing Data** | No per-mode AI effectiveness (does AI work better for spot vs futures?) · no heuristic vs AI win rate comparison |
| **Broken Widgets** | Verdict distribution bar empty if no calls logged · confidence bands blank if data warming up |
| **Stale Telemetry** | Edge report (120s) may lag AI metrics (30s) |
| **UX Issues** | AI toggle is prominent but rarely changed by founder · confidence threshold table is static (not connected to live win rate data) |
| **Navigation Issues** | None |
| **Mobile Issues** | Confidence table (4 columns) requires scroll on phone |
| **Duplicate Info** | Confidence threshold reference also shown in Settings page |
| **Low-Value Widgets** | Verdict distribution bar when data is sparse |
| **High-Value Improvements** | Confidence band recommendation ("Try 78% for +20% volume") · per-mode AI effectiveness chart · unified static + live confidence table |
| **Recommended Removals** | AI toggle (move to Settings or topbar) |
| **Recommended Consolidations** | Static threshold table + live performance table → single unified table |

---

### 10. `/admin/providers` — Provider Network

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Data provider health, quota, failover events, API key management |
| **Data Sources** | `adminApi.providers.list()` (30s) · `adminApi.providers.failoverHistory(20)` |
| **User Actions** | Enable/disable provider · set priority · force failover · configure API key · clear cache |
| **Missing Data** | No quota burn rate forecast · no provider latency trend · no failover trigger detail |
| **Broken Widgets** | API key test result may not reliably show plan name |
| **Stale Telemetry** | 30s — good |
| **UX Issues** | Coverage chip text is text-[8px] — nearly unreadable · provider cards are very dense · API key panel hidden by default |
| **Navigation Issues** | None |
| **Mobile Issues** | Provider cards stack vertically with each card being 500px+ tall |
| **Duplicate Info** | Provider health partially shown on `/admin/system` service status |
| **Low-Value Widgets** | Coverage chips (DEX Tokens, Meme Rotation) — informational, not actionable |
| **High-Value Improvements** | Quota burn forecast ("exhausted in ~8 days at current rate") · latency trend line · 3×2 quick health dashboard |
| **Recommended Removals** | Coverage chips (move to hover modal) |
| **Recommended Consolidations** | Tactical Ops summary → 6 large readable metric tiles instead of 6 tiny pills |

---

### 11. `/admin/cache` — Cache Operations

| Dimension | Finding |
|-----------|---------|
| **Purpose** | CMC quota tracking, cache group freshness, background worker status |
| **Data Sources** | `/api/cache/intelligence` (10s) |
| **User Actions** | Refresh all groups · refresh individual group |
| **Missing Data** | No cache hit/miss rate trend · no stale reason explanation · no quota usage by endpoint breakdown |
| **Broken Widgets** | Loading spinner may hang on slow API responses |
| **Stale Telemetry** | 10s — excellent |
| **UX Issues** | Quota progress bar lacks legend · "THROTTLED" warning does not explain impact on scans · background workers section rarely useful for founder |
| **Navigation Issues** | None |
| **Mobile Issues** | Quota 4-tile row overflows → should be 2×2 grid on mobile |
| **Duplicate Info** | CMC quota shown on `/admin/overview` and `/admin/providers` |
| **Low-Value Widgets** | Background Workers section |
| **High-Value Improvements** | Quota burn forecast · stale reason tooltip per group · throttle impact banner ("Scans are paused — quota resets in X hours") |
| **Recommended Removals** | Background Workers section (move to System Health) |
| **Recommended Consolidations** | Cache group list → single card with sortable columns |

---

### 12. `/admin/system` — System Health

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Backend service status, 24h operational metrics, system stack reference |
| **Data Sources** | `adminApi.health.ready()` (30s) · `adminApi.analytics.scans(24)` (30s) · `adminApi.analytics.ai(24)` (30s) |
| **User Actions** | None — fully read-only page |
| **Missing Data** | No database pool status (X/Y connections) · no Redis memory usage · no queue depth · no process uptime · no recent error log |
| **Broken Widgets** | None |
| **Stale Telemetry** | 30s — appropriate |
| **UX Issues** | Service status dot colours have no legend · stack reference table never changes but occupies space · metric cards do not link to related pages |
| **Navigation Issues** | None |
| **Mobile Issues** | 4-column metrics grid does not fit on phone → should be 2×2 |
| **Duplicate Info** | Service status overlaps `/admin/anomalies` error detection |
| **Low-Value Widgets** | System Stack reference table (belongs in documentation) |
| **High-Value Improvements** | DB pool % usage · queue depth indicator · process uptime since last restart · last 5 system errors |
| **Recommended Removals** | System Stack reference table |
| **Recommended Consolidations** | Service status + operational metrics → single compact dashboard |

---

### 13. `/admin/anomalies` — Anomaly Detection

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Threshold-based anomaly monitoring — detect performance degradation, queue backlog, errors |
| **Data Sources** | `adminApi.burnin.anomalies(96)` (60s) · `adminApi.burnin.status()` (60s) |
| **User Actions** | Manual refresh button only |
| **Missing Data** | No anomaly trend sparkline · no auto-resolution detection · no linked trace (which scan/signal triggered?) · no recommended actions per anomaly |
| **Broken Widgets** | None |
| **Stale Telemetry** | 60s — reasonable |
| **UX Issues** | Summary counters show "—" during load (no skeleton state) · anomaly descriptions are jargon-heavy (copied from code) |
| **Navigation Issues** | None |
| **Mobile Issues** | Anomaly row metadata overflows and loses alignment on small screens |
| **Duplicate Info** | None |
| **Low-Value Widgets** | "Monitored Checks" glossary section (useful as reference but takes primary screen space) |
| **High-Value Improvements** | Anomaly trend sparkline (improving/degrading) · auto-resolved badge · anomaly age column · action shortcut buttons for critical anomalies |
| **Recommended Removals** | Monitored Checks glossary (move to modal or hover tooltip) |
| **Recommended Consolidations** | Nothing |

---

### 14. `/admin/settings` — Operator Control

| Dimension | Finding |
|-----------|---------|
| **Purpose** | Quick operating mode presets, tactical sliders, raw settings editor, audit log |
| **Data Sources** | `adminApi.settings.all()` · `adminApi.settings.audit(150)` |
| **User Actions** | Apply 7 quick modes · adjust 8 tactical sliders · edit raw settings (accordion) · view audit log · reset group to defaults |
| **Missing Data** | No mode comparison tool · no predicted signal impact before saving · no mode activation history |
| **Broken Widgets** | None |
| **Stale Telemetry** | Real-time — settings apply immediately |
| **UX Issues** | 7 mode cards on one screen is overwhelming · number field save buttons inconsistent (toggles auto-save, numbers require click) · mode icons are ambiguous |
| **Navigation Issues** | None |
| **Mobile Issues** | 7 mode cards each full-width on phone → requires extensive scrolling |
| **Duplicate Info** | Nothing |
| **Low-Value Widgets** | System Stack reference (documentation-only content) |
| **High-Value Improvements** | Mode comparison modal (side-by-side diff) · predicted signal impact preview · 1-click revert to previous mode · mode activation history |
| **Recommended Removals** | Mode icons (use text labels only) |
| **Recommended Consolidations** | 7 modes → 3 recommended + "more" accordion |

---

## Sidebar Architecture Analysis

### Current Structure

```
OVERVIEW (2 pages)
  ├── Command Overview
  └── Market Intelligence

OPERATIONS (3 pages)
  ├── Scanner
  ├── Signals
  └── Tactical Feed

INTELLIGENCE (4 pages)
  ├── Edge Analytics
  ├── Regime Intelligence
  ├── Sector Rotation
  └── Calibration

INFRASTRUCTURE (4 pages)
  ├── Providers
  ├── Cache Operations
  ├── System Health
  └── Diagnostics

SYSTEM (1 page)
  └── Settings
```

### Problems Identified

| # | Issue | Impact |
|---|-------|--------|
| 1 | "OPERATIONS" is misleading — Signals and Tactical Feed are intelligence tools, not operational controls | Medium — confuses where to look |
| 2 | "Diagnostics" label is too vague — should say "Anomalies" or "Health Alerts" | Low — unclear what the page contains |
| 3 | Settings isolated in its own section at the bottom — high-use control page is buried | Medium — extra clicks to reach settings |
| 4 | No visual indicator of system alert state (no red dot when anomaly is critical) | High — silent failures go unnoticed |
| 5 | No clear "primary" page — all pages feel equal weight | Medium — no visual hierarchy for the critical path |

### Recommended Restructure

```
OVERVIEW (2 pages)
  ├── Command Center
  └── Market Intelligence

SIGNAL PIPELINE (3 pages)   [renamed from OPERATIONS]
  ├── Scanner
  ├── Signals
  └── Tactical Feed

INTELLIGENCE (4 pages)
  ├── Edge Analytics
  ├── Regime Intelligence
  ├── Sector Rotation
  └── Calibration

INFRASTRUCTURE (4 pages)
  ├── Providers
  ├── Cache Operations
  ├── System Health
  └── Anomalies              [renamed from Diagnostics]

⚙ Settings → move to top-right icon in admin topbar (not a sidebar section)
```

### Critical Path (Pages Opened Most)

| Priority | Page | Frequency | Why |
|----------|------|-----------|-----|
| 1 | Command Overview | Every session | Health check and signal summary |
| 2 | Tactical Feed | Every session | Monitor active signal lifecycle |
| 3 | Settings | Several times per week | Apply scan mode based on market |

### Rarely Visited Pages

Sectors · Calibration · System Health · Providers · Cache Operations — these are maintenance pages visited monthly or when something breaks.

---

## Workflow Gaps

| Workflow | Current State | Gap | Impact |
|----------|--------------|-----|--------|
| **Scan & Review** | Scan Now → wait → manually navigate to Signals | No auto-redirect or result panel | High — breaks trigger-to-review loop |
| **Regime Response** | See regime change → go to Settings → apply mode | No 1-click mode apply from Regime page | High — slow response to market shift |
| **Emergency Pause** | See anomaly → navigate to Scanner → disable | No quick pause on Overview | High — extra navigation under pressure |
| **Quota Depletion** | CMC quota depletes silently across 3 pages | No auto-throttle or unified warning | High — scans fail without notice |
| **Daily Report** | Trigger from Calibration → no feedback | No delivery confirmation | Medium — unknown if report was sent |
| **Setting Impact** | Change threshold → run scan → check results | No preview of predicted signal change | Medium — blind iteration |
| **Signal Backtest** | No way to re-run scan with different settings | No scenario testing | Medium — no iteration loop |
| **Regime Response** | Regime detected → recommended params shown | No 1-click apply from Regime page | Medium — extra steps |

---

## TOP 20 UX Issues

| # | Issue | Page | Impact | Recommended Fix |
|---|-------|------|--------|-----------------|
| 1 | Scan Now does not redirect to results | Scanner | 🔴 High | Auto-link to Signals with "new from this scan" filter |
| 2 | Edge warming up shows no progress count | Signals, Analytics | 🔴 High | Show "12 / 30 resolved signals" progress bar |
| 3 | 17 filter options visible simultaneously on Tactical | Tactical | 🔴 High | Collapse to dropdowns + preset buttons (Active / Won / Lost) |
| 4 | CMC quota shown in 3 places with no sync | Overview, Providers, Cache | 🔴 High | Single canonical quota tile; others show only badge |
| 5 | No regime change alert banner anywhere | Overview, Market, Regime | 🔴 High | Red banner with timestamp when regime changes |
| 6 | No emergency Pause Scanner button on Overview | Overview | 🔴 High | Large pause button next to status indicator |
| 7 | 7 mode cards on Settings overwhelm the screen | Settings | 🟠 Medium | Collapse to 3 recommended + "more" accordion |
| 8 | Scan Now shows no live progress after click | Scanner | 🟠 Medium | Animated progress bar showing coin count processing |
| 9 | ECE score shown without explanation | Analytics, Calibration | 🟠 Medium | Colour label: Excellent (< 0.05) / Fair / Poor |
| 10 | No Telegram cooldown state visible in dashboard | Signals, Tactical | 🟠 Medium | Show per-signal cooldown countdown badge |
| 11 | Regime page params do not link to Settings | Regime | 🟠 Medium | Add Apply button next to each recommended param |
| 12 | Number fields on Settings require manual save click | Settings | 🟠 Medium | Auto-save on blur with toast confirmation (consistent with toggles) |
| 13 | Coverage chip text is text-[8px] — unreadable | Providers | 🟠 Medium | Remove or move to modal tooltip |
| 14 | Futures fields visible when mode filter = spot | Signals | 🟡 Low-Med | Hide futures section when mode is spot |
| 15 | Anomaly descriptions use internal code jargon | Anomalies | 🟡 Low-Med | Plain English descriptions with severity icon |
| 16 | Mode icons on Settings are ambiguous | Settings | 🟡 Low-Med | Replace with descriptive text labels |
| 17 | "Updated" timestamp only changes when data changes | Overview | 🟡 Low | Show live "Refreshing…" spinner on every poll cycle |
| 18 | Rejection breakdown empty before first Scan Now | Scanner | 🟡 Low | Placeholder message: "Run a scan to see rejection breakdown" |
| 19 | Daily report trigger has no delivery confirmation | Calibration | 🟡 Low-Med | Show "Sent at HH:MM UTC ✓" badge with retry option |
| 20 | Sectors page has two redundant tables | Sectors | 🟡 Low | Remove coin-derived breadth table; keep CMC Categories only |

---

## TOP 20 Dashboard Issues

| # | Issue | Page | Impact | Recommended Fix |
|---|-------|------|--------|-----------------|
| 1 | No live next-scan countdown on Overview | Overview | 🔴 High | "Next standard scan: 8m 32s" live countdown |
| 2 | No 7-day win/loss ratio anywhere on Overview | Overview | 🔴 High | Add "7d W/L: 12W · 8L · 3T" summary pill |
| 3 | No lifecycle stage distribution visible | Signals, Overview | 🔴 High | Stage pills: "8 ACTIVE · 3 TP_HIT · 2 SL_HIT · 1 STALE" |
| 4 | No mode performance comparison | Signals, Analytics | 🔴 High | Mode win rate bar: Spot 62% · Futures 58% · HC 71% |
| 5 | Provider health buried in /providers page | Overview | 🔴 High | Provider health strip on Overview: CMC 🟢 Binance 🟢 |
| 6 | CMC quota burn forecast missing everywhere | Cache, Providers | 🔴 High | "CMC quota: exhausted in ~8 days at current rate" |
| 7 | Edge analytics warming up shows no progress | Analytics | 🔴 High | "18 / 30 resolved signals" progress bar |
| 8 | System Health has no real-time infra metrics | System | 🟠 Medium | Add DB pool % · Redis memory % · queue depth |
| 9 | Signal expanded card has no visual hierarchy | Signals | 🟠 Medium | Group: Trade Levels / Technicals / AI Reasoning / Futures |
| 10 | Market page missing sector rotation context | Market | 🟠 Medium | Top 3 rising / top 3 falling sector pills |
| 11 | Anomalies page has no trend direction | Anomalies | 🟠 Medium | Sparkline: anomaly count last 48h trending up/down |
| 12 | Calibration confidence threshold table is static | Calibration | 🟠 Medium | Add live win rate column next to each tier |
| 13 | Regime page recommended params are not actionable | Regime | 🟠 Medium | Add "Apply to Settings" button per parameter row |
| 14 | Settings audit log shows "by system" for all entries | Settings | 🟠 Medium | Show source: "by Scan Now" · "by Mode: Aggressive" · "by Admin" |
| 15 | Tactical feed has no stage transition history | Tactical | 🟠 Medium | Expandable timeline: VALIDATED → AI_APPROVED → ACTIVE with times |
| 16 | Providers summary uses 6 unreadable tiny pills | Providers | 🟠 Medium | 6 large metric tiles with icons instead |
| 17 | Cache background workers section adds little value | Cache | 🟡 Low-Med | Move to System Health or remove |
| 18 | Market top movers shows 8 coins — too many | Market | 🟡 Low-Med | Limit to 5 with "see all" link |
| 19 | Analytics attribution refreshes every 5 minutes | Analytics | 🟡 Low | Reduce to 60s or add manual refresh button |
| 20 | Sectors page shows two overlapping breadth tables | Sectors | 🟡 Low | Remove coin-derived table; keep CMC categories only |

---

## TOP 20 Mobile Issues

| # | Issue | Page | Impact | Recommended Fix |
|---|-------|------|--------|-----------------|
| 1 | 9-column Tactical table forces full horizontal scroll | Tactical | 🔴 Critical | Collapse to 4 key columns on mobile; remainder in expand |
| 2 | Signal expanded card — all fields stack with no grouping | Signals | 🔴 Critical | 2-column grid with section headers on mobile |
| 3 | 7 mode cards each full-width on Settings | Settings | 🔴 High | Horizontal scroll carousel or swipeable cards on mobile |
| 4 | Analytics calibration table (5 columns) scrolls awkwardly | Analytics | 🔴 High | Show 3 key columns on mobile; hide Sharpe/profit factor |
| 5 | Provider cards are 500px+ tall each on phone | Providers | 🔴 High | Collapse to status pill; expand on tap |
| 6 | Scanner rejection bar chart clips content on phone | Scanner | 🔴 High | Horizontal scroll container or limit to top 5 gates |
| 7 | Overview cache groups strip overflows to 3 rows | Overview | 🟠 High | Convert to 2×2 grid on mobile |
| 8 | Cache quota 4-tile row overflows | Cache | 🟠 High | Convert to 2×2 grid on mobile |
| 9 | System Health 4-column metrics grid | System | 🟠 High | Convert to 2×2 grid on mobile |
| 10 | Regime RSI gauge is too wide for phone | Regime | 🟠 Medium | Constrain gauge to 60% width on mobile |
| 11 | Sectors two full-width tables | Sectors | 🟠 Medium | Tab between tables on mobile |
| 12 | Signals filter row wraps to 4+ lines on phone | Signals | 🟠 Medium | "Filter" button opening a bottom sheet modal |
| 13 | Market breadth table horizontal overflow | Market | 🟠 Medium | Horizontal scroll with sticky first column |
| 14 | Anomaly row metadata wraps and loses alignment | Anomalies | 🟠 Medium | Single-column layout with clear section separation |
| 15 | Providers Routing Events list is very long with no pagination | Providers | 🟠 Medium | Limit to 5 with "Show more" button |
| 16 | Tactical filter bar wraps to 3 lines | Tactical | 🟠 Medium | Icon-only filter row + modal on phone |
| 17 | Settings tactical sliders (4 columns) break | Settings | 🟠 Medium | Single column on mobile with section headers |
| 18 | Edge validation confidence band table (5 columns) | Analytics | 🟠 Medium | Show 3 columns on mobile |
| 19 | Cache group freshness strip shows full detail on phone | Cache | 🟡 Low-Med | Status icon only on mobile; detail on tap |
| 20 | Signal card entry/target/stop prices too close on phone | Signals | 🟡 Low-Med | Increase spacing; larger price font on mobile |

---

## TOP 20 Workflow Improvements

| # | Improvement | Workflow | Current State | Proposed State |
|---|-------------|----------|--------------|----------------|
| 1 | Auto-redirect to Signals after Scan Now | Scan & Review | Founder clicks Scan Now → waits → manually navigates to Signals | Redirect to Signals with "new signals from this scan" filter after completion |
| 2 | 1-click Regime Mode Apply | Regime Response | See regime on Regime page → go to Settings → find mode → apply | Regime page shows "EUPHORIA detected — Apply Sniper Mode?" with 1-click button |
| 3 | Emergency Pause on Overview | Emergency Response | See anomaly → navigate to Scanner → click Disable | Large "⚠ Pause Scanner" button on Overview next to status pill |
| 4 | Quota Depletion Auto-Warning | Quota Management | CMC quota depletes silently; scans eventually fail | Red banner on all pages when quota < 2 scans remaining |
| 5 | Daily Report Delivery Confirmation | Reporting | Click Send Daily Report → no feedback | Show "Sent to Telegram at 09:15 UTC ✓" with retry button if failed |
| 6 | Setting Impact Preview | Tune Signals | Change min_confidence=75 → run scan → check results | Settings shows "Estimated: +30% signal volume · -5% expected WR" before save |
| 7 | Signal Lifecycle Timeline on Card Expand | Signal Review | No visibility into when signal progressed through stages | Expandable timeline: VALIDATED 09:01 → AI_APPROVED 09:01 → ACTIVE 09:02 |
| 8 | Provider Health Quick-Status on Overview | Infrastructure Monitoring | Must navigate to Providers page for health | Overview strip: CMC 🟢 42ms · Binance 🟢 18ms · CoinGecko 🟡 slow |
| 9 | Scan Mode Performance Comparison | Strategy Tuning | No visible mode comparison | Analytics: Spot 62% WR · Futures 58% WR · High-Conf 71% WR |
| 10 | Preset Filter Buttons on Tactical | Signal Monitoring | Must click 3+ individual filters to see active signals | One-click preset buttons: "Active Signals" · "Won" · "Lost" |
| 11 | Confidence Band Recommendation | Credit Optimisation | Founder sets confidence manually with no data guidance | Calibration: "Your 85% tier has 71% WR — try 80% for more volume with acceptable edge" |
| 12 | Anomaly Action Shortcuts | Incident Response | Read anomaly text → manually decide next action | Each critical anomaly has action buttons: "Pause Scanner" · "Check Signals" · "View Providers" |
| 13 | Regime Duration Meter | Market Context | Current regime shown without duration | Regime page: "BULL_TREND for 8h 23m — typical duration: ~12h" |
| 14 | Live Next-Scan Countdown | Operational Awareness | Static "Next standard: Xm Ys" that does not tick | Live countdown ticking: "Next standard scan in 08:47…" |
| 15 | Mode Activation History | Settings Context | No history of which mode was previously active | Timeline: "Aggressive since 2h ago · Balanced 6h · Conservative 18h" |
| 16 | Signal Stage Distribution on Overview | Health at a Glance | No summary of signals by lifecycle stage | "12 ACTIVE · 8 TP_HIT · 5 SL_HIT · 3 STALE" pill row on Overview |
| 17 | Mode Comparison Modal | Strategy Selection | Founder must mentally compare 7 modes | Click "Compare" between any 2 modes → diff table of all changed settings |
| 18 | Analytics Edge Progress Bar | Analytics Warmup | "Edge warming up" text with no progress | "18 / 30 resolved signals — edge verdict in ~3 more scans" |
| 19 | Visual Highlight for New Signal During Session | Alert Workflow | Signals page refreshes but new cards look identical | New signal cards flash "NEW" badge for 30 seconds on arrival |
| 20 | Settings 1-Click Revert | Recovery | Settings changed → signals degrade → hard to undo | "Revert to previous (Balanced, 3h ago)" 1-click undo in Settings header |

---

## Critical Issues — Fix First

These 5 issues cause the most friction in daily use and should be prioritised immediately:

| Priority | Issue | Where | Why Critical |
|----------|-------|-------|-------------|
| 🔴 1 | Scan Now does not redirect to results | Scanner | Breaks the core scan → review loop every single use |
| 🔴 2 | No Emergency Pause button on Overview | Overview | Forces navigation under time pressure during anomaly |
| 🔴 3 | Mobile unusability — Tactical Feed and Signals expanded | Tactical, Signals | Dashboard unusable on phone after Telegram alert |
| 🔴 4 | CMC quota warning not prominent or synced | Cache, Providers, Overview | Risk of scan failures without advance notice |
| 🔴 5 | Edge analytics shows no warmup progress count | Analytics, Signals | Founder cannot tell how close to real data |

---

## Quick Wins — Under 1 Hour Each

These 10 improvements are small code changes with high daily impact:

| # | Change | Where | Effort |
|---|--------|-------|--------|
| 1 | Add "12 / 30" progress count to edge warming up banner | Analytics, Signals | 15 min |
| 2 | Add "⚠ Pause Scanner" button to Overview page | Overview | 30 min |
| 3 | Add regime change timestamp banner on Overview | Overview | 20 min |
| 4 | Rename sidebar "OPERATIONS" → "SIGNAL PIPELINE" | Sidebar | 5 min |
| 5 | Rename sidebar "Diagnostics" → "Anomalies" | Sidebar | 5 min |
| 6 | Add "Apply" buttons next to recommended params on Regime page | Regime | 45 min |
| 7 | Limit top movers on Market page to 5 coins | Market | 10 min |
| 8 | Remove sector breadth table from Sectors page | Sectors | 10 min |
| 9 | Add ECE score colour labels (Excellent/Fair/Poor) to Calibration | Calibration | 20 min |
| 10 | Add "Sent at HH:MM UTC ✓" confirmation after daily report trigger | Calibration | 20 min |

**Total estimated time for all 10 quick wins: ~3 hours**

---

*Report generated by automated multi-agent analysis of source code and UI components.*  
*All findings are based on static code analysis of `app/admin/**` and `components/admin/sidebar.tsx`.*
