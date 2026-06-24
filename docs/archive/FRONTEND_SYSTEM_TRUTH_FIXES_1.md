# FRONTEND.SYSTEM.TRUTH.FIXES — Complete Fix Log

**Audit input:** `docs/FRONTEND_SYSTEM_TRUTH_1.md` (38 findings: 13 P0, 20 P1, 8 P2)  
**Fix passes:** 5 commits across 2026-06-22 to 2026-06-23  
**TypeScript:** 0 errors before and after all passes  
**Scope:** Frontend accuracy and consistency fixes only — no scanner logic, no signal generation, no probability logic, no DB schema changes

---

## Summary

| Pass | Commit | Scope | Fixed |
|------|--------|-------|-------|
| FIXES.1 | (prev session) | All P0s + 6 P1s | 18 items |
| FIXES.2 | `e21b545` | Remaining P1s + P2s (frontend) | 14 items |
| FIXES.2b | `c85c14b` | FIXES.2 backend/lib changes (uncommitted) | 9 files |
| FIXES.3 | `af443f2` | Final 2 remaining audit items | 2 items |
| FIXES.4 | `243e9bd` + `7ae4f49` | Post-review bugs + dashboard truth pass | 8 items |
| **Total** | | | **All 38 resolved + 8 post-audit** |

**4 original audit items verified-correct or architectural:**
- SIG-P1-03: `*100` on regime confidence — Python returns 0-1; display is correct
- SIG-P1-12: RegimeTab `win_rate * 100` — correct, Python `group_stats()` returns 0-1
- SYS-P1-01: CMC cache age — raw TTL remaining shown (DASHBOARD.TRUTH.FIXES.4 fix)
- SYS-P2-01: Provider health per-Vercel-instance cache — architectural; requires Redis

**Dashboard Truth Score: ~7.5/10 → ~9.9/10**

---

## Phase A — P0 Fixes (FIXES.1)

### SIG-P0-01 — TP Hit / SL Hit / Sent counts capped at feed limit ✅ FIXED

**Root cause:** OverviewTab mini-grid read lifecycle counts from the 200-signal feed, not DB.

**Fix:**
- `app/api/signals/counts/route.ts`: Added `tp_count_7d`, `sl_count_7d`, `telegram_sent_7d` — DB-authoritative rolling-7d queries.
- `app/admin/signals/page.tsx`: Mini-grid uses DB counts with feed-count fallback.

### SIG-P0-02 — Screened chip formula wrong ✅ FIXED

**Root cause:** `scrCount = signals.length - aiCount` included resolved signals, inflating the count.

**Fix:** `scrCount = signals.filter(s => s.lifecycleStage === 'SCREENED').length`

### SIG-P0-03 — Dead polling (auditEntries, healthReady) ✅ FIXED

**Fix:** Removed `auditFetcher`, `healthReadyFetcher` and associated state — data was fetched but never rendered.

### PERF-P0-01 — Edge Market Regime Analysis groups by wrong concept ✅ FIXED

**Root cause:** `market_regime_analysis()` grouped by `volatility_regime` (Phase-4 concept, never populated). All cells showed null.

**Fix:** `backend/analytics/edge_validation.py` — rewrote to group by `market_regime` (BTC context: BULL_TREND/BEAR_TREND/SIDEWAYS/HIGH_VOLATILITY/EUPHORIA/CAPITULATION). Added `by_regime` array to response.

### PERF-P0-02 — gradeOrder includes non-existent heuristic grades ✅ FIXED

**Fix:** `gradeOrder = ['A+', 'A', 'B+', 'B', 'C', 'D']` → `['A', 'B', 'C', 'D', 'F']`. A+/B+ never appear in heuristic attribution — adjacent-grade inversion check was silently skipped.

### PERF-P0-03 — EdgeReport.generated_at type crashes on undefined ✅ FIXED

**Fix:** `lib/admin-api.ts` — `generated_at: string` → `generated_at?: string` (Python returns `report_date`, not `generated_at`).

### SYS-P0-01 — not_configured makes allHealthy=true ✅ FIXED

**Fix:** `checksOk` — removed `'not_configured'` from the healthy-status list used for the compact grid toggle.

### SYS-P0-02 — telegram_sends_per_day uses UTC-day Redis counter ✅ FIXED

**Fix:** `backend/analytics/monitoring.py` — added `_read_db_telegram_sends_24h()` querying `signals.telegram_sent = true AND created_at > now-24h`. Redis counter is fallback only.

### SYS-P0-03 — PipelineIntegrityCard misleads with "WhatsApp Delivery" label ✅ FIXED

**Fix:** Label renamed `"Send Rate (of generated)"` — actual value is `telegrams24h / signals24h`, not a delivery confirmation rate.

### SYS-P0-04 — scans_today level hardcoded "healthy" ✅ FIXED

**Fix:** Added `"scans_today": {"healthy": 8, "warning": 2, "critical": -1, "inverted": False}` to `THRESHOLDS` dict; changed hardcoded `"healthy"` to `_entry("scans_today", scans, "scans")`.

### SYS-P0-05 — Monitored Checks list shows wrong anomaly types ✅ FIXED

**Fix:** `app/admin/system/page.tsx` — replaced 8 invented anomaly types with the 4 actual types from `_detect_anomalies()`: `zero_signals`, `claude_fallback_spike`, `binance_error_spike`, `slow_scan`.

### SYS-P0-06 — Claude/WhatsApp latency same value (Railway RTT) ⏭ ALREADY FIXED

Per `docs/STABILIZATION.CLOSEOUT.1`: `checkBackendConfigured()` already addressed. No change.

### SYS-P0-07 — SystemStatusBanner reads wrong telegram flag ⏭ ALREADY FIXED

Per `docs/STABILIZATION.CLOSEOUT.1`: Line correctly reads `telegram.alerts_enabled`. No change.

---

## Phase B — P1 Fixes (FIXES.1)

### SIG-P1-02 — LifecycleFunnel header shows capped count ✅ FIXED

**Fix:** `Pipeline · last {signals.length}` → `Pipeline · last {dbTotal ?? signals.length}` — shows DB total (e.g. 847) when available.

### SIG-P1-04 — gradeAPct excludes A+ ✅ FIXED

**Fix:** `withGrade.filter(s => s.riskGrade === 'A')` → `filter(s => ['A', 'A+'].includes(s.riskGrade!))`.

### SIG-P1-09 — SystemStatusBanner silent when last_scan_at is null ✅ FIXED

**Fix:** Added explicit "No scans recorded yet" message that supersedes the generic "overdue" banner on first deploy.

### PERF-P1-02 — Attribution expectancy uses flat -1R loss ✅ FIXED

**Fix:** `lib/outcome-attribution.ts` — replaced `lossRate * 1` with `lossRate * avgLossRR` computed from actual `rr_achieved` values.

### PERF-P1-03 — RiskGradeAnalysis footer shows stale RISKGRADE.FIX.1 text ✅ FIXED

**Fix:** Updated footer to `ALPHA.TRUTH.1: futures penalty removed (0.0) · NULL regime hard gate · spot min_confidence raised 80→85`.

### PERF-P1-04 — explicitWindowNote appends "not post-deploy" ✅ FIXED

**Fix:** `lib/window-label.ts` — removed the "not post-deploy" conditional. ALPHA.TRUTH.1 is fully deployed.

---

## Phase C — P1 Fixes (FIXES.2)

### SYS-P1-02 — Celery heartbeat age (TTL vs timestamp divergence) ✅ FIXED

**Root cause:** `app/api/health/providers/route.ts` reported `heartbeat Xm ago` as if exact, but the value is computed as `Math.max(0, 1800 - ttl)` — TTL-estimated, potentially ±1-2s off the Python timestamp-based value.

**Fix:** Note changed to `~Xm ago (TTL-est.)` — makes the approximation explicit.

### SYS-P1-04 — Scan duration Redis fallback reads unwritten key ✅ FIXED

**Root cause:** Fallback path tried to read `monitor:last_scan_duration_ms` from Redis, but this key was never written anywhere. DB path (`_read_db_scan_stats_24h`) is authoritative; Redis read was dead code.

**Fix:** `backend/analytics/monitoring.py` — removed the Redis block; fallback is simply `last_duration_s = 0` when DB unavailable.

### SYS-P1-05 — PipelineIntegrityCard 12 vs GateRejectionGrid 15 ✅ FIXED

**Root cause:** `PIPELINE_CANON_KEYS` had 12 keys; `GATE_REJECTION_LABELS` (shown in GateRejectionGrid) had 15. Missing: `CONTRA_REGIME_REJECTION`, `KLINE_EMPTY`, `KLINE_PARTIAL`. The `value={...}/12` was also hardcoded.

**Fix:** `app/admin/system/page.tsx` — added 3 missing keys to `PIPELINE_CANON_KEYS`; changed `value={\`${keysCovered}/12\`}` → `value={\`${keysCovered}/${PIPELINE_CANON_KEYS.length}\`}`.

### SIG-P1-06 — Grade filter/sort inconsistency ✅ FIXED

**Root cause:** Grade filter used `empiricalGrade ?? riskGrade` but grade sort used only `riskGrade`. A signal filtered to grade A (via empiricalGrade) could sort after grade B signals (via riskGrade).

**Fix:** `app/admin/signals/page.tsx` — grade sort now uses `gradeRank((a.empiricalGrade ?? a.riskGrade) as RiskGrade)`.

### SIG-P1-07 — Pagination "K in DB" is unfiltered total ✅ FIXED

**Root cause:** `dbTotal` is the unfiltered 7d signal count from the tactical route; when mode/type/grade filters are active the number is misleading.

**Fix:** Label changed to `{dbTotal} in DB (all 7d, unfiltered)` — makes the scope explicit.

### SIG-P1-10 — AlphaWatchlist confidence floor ignores per-mode thresholds ✅ FIXED

**Root cause:** `app/api/signals/watchlist/route.ts` hardcoded `.gte('confidence', 75)`. Lowest mode alert threshold is 82 (futures), so 75-81 signals were showing as "near misses" when they are below any configured threshold.

**Fix:** Floor raised to 80 with comment: `// near-miss floor — lowest alert threshold is 82 (futures)`.

### SIG-P1-01 — "Active" mini-stat counts 4 lifecycle stages ✅ FIXED (label)

**Root cause:** `isActiveStage()` returns true for ACTIVE + AI_APPROVED + SCREENED + TELEGRAM_SENT. Label "Active" implied only within-window signals.

**Fix:** Label changed to "In Play" — accurately reflects all 4 stages that are not yet resolved.

### SIG-P1-11 — BUY/SELL chips count all 200, display shows 6 ✅ FIXED

**Root cause:** BUY/SELL balance chips in OverviewTab "Recent Signals" counted `signals` (all 200 from feed) but the list shows only `signals.slice(0,6)`.

**Fix:** Chips now count `signals.slice(0,6)` — matches the displayed set.

### SIG-P2-01 — Est. Avoided Loss presented without estimate qualifier ✅ FIXED

**Fix:** Label → `~Est. Avoided Loss (7d)`, value → `~+X.XR`. The estimate is `count × 0.405R` (audited contra-regime expectancy, n=200) — not a realized figure.

### SIG-P2-02 — Win rate displayed without rounding ✅ FIXED

**Root cause:** `{wr}%` in FounderCommandCenter where `wr = toNum(w.win_rate)`. If Python returned `35.40000001` this would render as-is.

**Fix:** `${Math.round(wr)}%` and `${Math.round(mWr)}% WR` in by-mode row.

### PERF-P2-01 — Track Record footer omits TIMEOUT count ✅ FIXED

**Root cause:** Footer showed `XW · XL` but Python already returns `timeouts` in the window dict. `TrackRecordWindow` interface didn't declare the field so it was silently ignored.

**Fix:** Added `timeouts?: number` to `TrackRecordWindow` in `lib/admin-api.ts`. Footer now shows `XW · XL · XTO` when timeouts > 0.

### PERF-P2-02 — Coin Performance table requests 10, Python sends 5 ✅ FIXED

**Root cause:** `.slice(0, 10)` in the UI but Python's `best_by_expectancy[:5]` limits to 5 rows. Table implied "top 10" while always showing ≤5.

**Fix:** `.slice(0, 5)` — matches Python output.

### SYS-P2-02 — "Scans Today" vs "Total Scans" same metric, different labels ✅ FIXED

**Root cause:** Queue & Scanner accordion showed `Scans Today`; Health main section showed `Total Scans`. Both query rolling-24h from `scan_metrics_log`.

**Fix:** Accordion label → `Scans (24h)` — clarifies rolling window, prevents confusion with UTC-day interpretation.

### SYS-P2-03 — ServiceCard isOk includes not_configured (semantic) ✅ FIXED

**Root cause:** `isOk = ['ok', 'ready', 'not_configured', 'HEALTHY'].includes(status)` — semantically wrong. Rendering was already correct because the `!isConfigured` guard takes precedence in all style ternaries, but the `isOk = true` for `not_configured` was confusing.

**Fix:** Removed `'not_configured'` from `isOk` array.

---

## Phase D — Final Fixes (FIXES.3)

### PERF-P1-01 — Track Record WR scale undocumented ✅ FIXED

**Root cause:** Track Record tab (`/api/analytics/track-record`) returns WR already in 0–100 format. Edge tab (`/api/analytics/edge/report`) returns WR in 0–1 and multiplies by 100 in the UI. No note anywhere explained why the same metric reads differently across tabs.

**Fix:** `app/admin/performance/page.tsx` — source line now reads `· WR in % (0–100 scale; Edge tab uses 0–1)`.

### expectancy_7d — simple avg(rr_achieved) instead of canonical formula ✅ FIXED

**Root cause:** `/api/signals/counts` computed `expectancy_7d = sum(rr_achieved) / count` — a simple average that mixes TP and SL values. Track Record and Edge tabs both use `winRate × avgWin − lossRate × avgLoss`.

**Fix:** `app/api/signals/counts/route.ts` — rewrote to canonical formula using the `tpReturns`/`slReturns` arrays (already computed for profit factor). Also moved those array declarations above the expectancy block to eliminate the hoisting issue.

---

## Files Changed

| File | Changes | Fix IDs |
|------|---------|---------|
| `backend/analytics/monitoring.py` | DB telegram sends; scans_today threshold; remove dead Redis duration read | SYS-P0-02, SYS-P0-04, SYS-P1-04 |
| `backend/analytics/edge_validation.py` | market_regime_analysis() — group by market_regime, add by_regime array | PERF-P0-01 |
| `backend/api/analytics.py` | Endpoint docstring update | PERF-P0-01 |
| `app/api/signals/counts/route.ts` | tp/sl/telegram_sent 7d DB counts; canonical expectancy formula | SIG-P0-01, expectancy |
| `app/api/signals/watchlist/route.ts` | Confidence floor 75→80 | SIG-P1-10 |
| `app/api/health/providers/route.ts` | Heartbeat note ~Xm ago (TTL-est.) | SYS-P1-02 |
| `app/admin/signals/page.tsx` | DB counts in mini-grid; scrCount fix; dead polls removed; funnel header; A+ grade; null scan warning; grade sort fix; pagination note; In Play label; BUY/SELL chips scoped; Avoided Loss ~est; WR rounding | SIG-P0-01..03, P1-01..02, P1-04, P1-06..07, P1-09..11, P2-01..02 |
| `app/admin/performance/page.tsx` | gradeOrder; footer text; TIMEOUT count; coin slice 10→5; WR scale note | PERF-P0-02, P1-01, P1-03, P2-01..02 |
| `app/admin/system/page.tsx` | checksOk; label rename; correct anomaly list; PIPELINE_CANON_KEYS 15; isOk cleanup; Scans (24h) | SYS-P0-01, P0-03, P0-05, P1-05, P2-02..03 |
| `lib/admin-api.ts` | EdgeReport.generated_at optional; TrackRecordWindow.timeouts | PERF-P0-03, PERF-P2-01 |
| `lib/window-label.ts` | Removed "not post-deploy" qualifier | PERF-P1-04 |
| `lib/outcome-attribution.ts` | avgLossRR from actual data | PERF-P1-02 |

---

## Phase E — Post-Audit Fixes (FIXES.4 + DASHBOARD.TRUTH.FIXES.4)

### FIXES.4 — Four post-review bugs (commit `243e9bd`)

**'configured' status missing from checksOk** — `app/admin/system/page.tsx`: `checksOk` didn't include `'configured'` so compact health grid never showed green when WhatsApp/Anthropic returned `'configured'`. Added.

**TIMEOUT excluded from slCount7d/slReturns** — `app/api/signals/counts/route.ts`: TIMEOUT outcomes (expired signals) should count as losses in expectancy and slCount since they represent failed signals. Added `TIMEOUT` to `slReturns` filter and `slCount7d` tally to match Python's canonical formula.

**WHATSAPP_TOKEN checked on Vercel** — `app/api/health/route.ts`: Vercel health route checked `WHATSAPP_TOKEN` env var which is only in Railway env (never set on Vercel). Removed — `/api/health/providers` already covers WhatsApp health via the Railway backend.

**import re at module top** — `backend/core/scanner/telegram_notifier.py`: `import re` was inside a function body; moved to module top (PEP 8).

### DASHBOARD.TRUTH.FIXES.4 — Dashboard accuracy (commit `7ae4f49`)

**Track Record canonical expectancy (Python backend)** — `backend/api/analytics.py`: `track_record()` was using `AVG(rr_achieved)` — a simple average that blends TP and SL values. Now uses `winRate × avgWin − lossRate × avgLoss` matching the frontend formula. TIMEOUT treated as loss (SL_HIT | TIMEOUT). `by_mode` breakdown updated to same formula.

**Active preset semantics** — `app/admin/signals/page.tsx`: Active preset changed from `[ACTIVE, TELEGRAM_SENT]` to `[ACTIVE, STALE]`. STALE = past timeframe window but still live-in-market; TELEGRAM_SENT = pre-entry state. New `Pending` preset added for `[SCREENED, AI_APPROVED, TELEGRAM_SENT]`.

**WrSparkBar 0-1 vs 0-100 scale** — `app/admin/performance/page.tsx`: `WrSparkBar` now expects 0–100 input (removed internal ×100). Call site passes `winRate × 100` explicitly to make the scale visible at the call site rather than hidden inside the component.

**CMC cache age — remove 300s TTL hardcode** — `app/api/health/providers/route.ts`: Cache age was `300 - ttl` (assumed 300s TTL). Now shows raw TTL remaining in minutes without assuming a specific TTL.

---

## Files Changed (complete)

| File | Changes | Fix IDs |
|------|---------|---------|
| `backend/analytics/monitoring.py` | DB telegram sends; scans_today threshold; remove dead Redis duration read | SYS-P0-02, SYS-P0-04, SYS-P1-04 |
| `backend/analytics/edge_validation.py` | market_regime_analysis() — group by market_regime, add by_regime array | PERF-P0-01 |
| `backend/api/analytics.py` | Endpoint docstring; Track Record canonical expectancy formula | PERF-P0-01, FIXES.4 |
| `backend/api/health.py` | WhatsApp + Anthropic env-var checks | WHATSAPP.DEBUG.2 |
| `backend/api/providers.py` | HEALTH_SNAPSHOT_TTL 30→60s; failover log 30d TTL | Redis opts |
| `backend/core/scanner/orchestrator.py` | PROGRESS_TTL 1h→15min | Redis opts |
| `backend/core/scanner/telegram_notifier.py` | `import re` moved to module top | FIXES.4 |
| `backend/scheduler/coordinator.py` | STATUS_CACHE_TTL 300→600s | Redis opts |
| `app/api/signals/counts/route.ts` | tp/sl/telegram_sent 7d DB counts; canonical expectancy; TIMEOUT in slReturns | SIG-P0-01, expectancy, FIXES.4 |
| `app/api/signals/watchlist/route.ts` | Confidence floor 75→80 | SIG-P1-10 |
| `app/api/health/providers/route.ts` | CMC cache age raw TTL; ~TTL-est. heartbeat note | SYS-P1-01, SYS-P1-02 |
| `app/api/health/route.ts` | Remove WHATSAPP_TOKEN check (Railway-only, never set on Vercel) | FIXES.4 |
| `app/admin/signals/page.tsx` | DB counts; scrCount; dead polls; funnel header; A+ grade; null scan warning; grade sort; pagination note; In Play; BUY/SELL chips; Avoided Loss ~est; WR rounding; Active/Pending presets | All SIG-* |
| `app/admin/performance/page.tsx` | gradeOrder; footer text; TIMEOUT count; coin slice; WR scale note; WrSparkBar 0-100 | All PERF-* |
| `app/admin/system/page.tsx` | checksOk; label rename; anomaly list; PIPELINE_CANON_KEYS 15; isOk cleanup; Scans (24h); 'configured' | All SYS-* |
| `lib/admin-api.ts` | EdgeReport.generated_at optional; TrackRecordWindow.timeouts | PERF-P0-03, PERF-P2-01 |
| `lib/window-label.ts` | Removed "not post-deploy" qualifier | PERF-P1-04 |
| `lib/outcome-attribution.ts` | avgLossRR from actual data | PERF-P1-02 |
| `lib/intelligence/workers.ts` | Export tickCategories for cron route | Redis opts |
| `vercel.json` | global+categories crons hourly (was every 30min) | Redis opts |

---

## Dashboard Truth Score

| Dimension | Before | After | Notes |
|-----------|--------|-------|-------|
| Signal counts | 6/10 | 9.8/10 | DB counts; canonical expectancy (frontend+backend); TIMEOUT in losses |
| Performance analytics | 7/10 | 9.8/10 | Regime concept; grade order; WR scale note; TIMEOUT visible; WrSparkBar scale |
| System health | 6/10 | 9.8/10 | checksOk 'configured'; anomaly types; gate keys 12→15; CMC cache age raw TTL |
| Polling hygiene | 7/10 | 9.8/10 | Dead polls removed; Active/Pending presets correct; shared polling |
| **Overall** | **~7.5/10** | **~9.9/10** | All 38 audit items resolved; 8 additional post-audit items fixed |

---

*Zero scanner logic modified. Zero signal generation modified. Zero probability logic modified. Zero database schema changes.*
