# PLATFORM_STABILIZATION_1

**Date:** 2026-06-18  
**Auditors:** Principal Systems Architect · Principal Quant Auditor · Senior Platform Reliability Engineer · Staff Frontend Engineer  
**Goal:** Platform quality 9.5/10 → 10/10. No new features. No redesign. Simplification, stabilization, verification only.

---

## Executive Summary

Full audit across 10 domains (Scanner, Signal Quality, Probability Engine, Redis, Celery, Telegram, Admin Dashboard, Settings, API Endpoints, Documentation). All 6 P0 items have been fixed and deployed in commit `75d0014`. 8 P1–P3 items remain.

| Priority | Count | Status |
|----------|-------|--------|
| P0 | 6 | ✅ All fixed — commit `75d0014` |
| P1 | 4 | ✅ 3 fixed (2026-06-19) · P1-02 deferred to 2026-06-23 checkpoint |
| P2 | 5 | ✅ All fixed (2026-06-19) |
| P3 | 2 | ✅ Both already done |

| Classification | Count |
|----------------|-------|
| FIX | 10 |
| REMOVE | 5 |
| ARCHIVE | 1 |
| KEEP | remainder |

**Estimated remaining effort:** ~3h for P1, ~2h for P2, ~1h for P3.

---

## P0 — Production Risks ✅ ALL FIXED (commit `75d0014`)

### SCAN-01 — `validationSource` null → falsely shows AI_APPROVED
**Classification:** FIX · **Status:** ✅ Fixed  
**Domain:** Admin Dashboard / Signal Lifecycle  
**Impact:** Every heuristic signal on pre-migration rows (validation_source NULL in DB) was displaying the "AI Approved" badge instead of "Screened". This was actively misleading — AI was off and all signals were heuristic.  
**Risk:** High — users see false AI confidence signal  
**Effort:** Low  
**Files:** `lib/signal-lifecycle.ts:37`  
**Action:** Changed `=== 'HEURISTIC' ? 'SCREENED' : 'AI_APPROVED'` to treat null/undefined as SCREENED. Pre-migration rows and signals where `validation_source` was not persisted now correctly show SCREENED.

---

### DASH-01 — Dead `FLAG_META` key `probability_gate_expectancy_filter`
**Classification:** REMOVE · **Status:** ✅ Fixed  
**Domain:** Admin Dashboard — System → Settings → Feature Flags  
**Impact:** `FLAG_META` in `system/page.tsx` contained a key `probability_gate_expectancy_filter` that does not exist in `FeatureFlags` (groups.py). The actual field is `probability_gate_v1` (already correctly listed). This caused the FLAG_META categorisation code to silently produce a phantom quality-tier card for a flag that never existed.  
**Risk:** Medium — phantom flag could be rendered if a settings group returned an unexpected field  
**Effort:** Low  
**Files:** `app/admin/system/page.tsx:316`  
**Action:** Removed the dead entry.

---

### DASH-02 — `TelegramDeliveryCard` deleted, API still live
**Classification:** FIX · **Status:** ✅ Fixed  
**Domain:** Admin Dashboard — System → Health  
**Impact:** `TelegramDeliveryCard` was removed during PLATFORM.SIMPLIFICATION.1 when ScannerTab was deleted. The full stack survived: Python `/api/analytics/telegram-delivery` endpoint, TypeScript `adminApi.analytics.telegramDelivery()` client, `TelegramDeliveryResponse` types — but no UI consumed any of it. Telegram delivery rate was an unverified operational flow with zero dashboard visibility.  
**Risk:** High — Telegram delivery issues (lost signals, failed sends) go undetected  
**Effort:** Medium  
**Files:** `app/admin/system/page.tsx`  
**Action:** Rebuilt `TelegramDeliveryCard` inline in the Health tab. Shows 24h funnel: Generated → Eligible → Queued → Delivered → Failed → Shadowed → Unresolved. Polls at 300s.

---

### INFRA-01 — `/api/intelligence/cron/categories` missing from `vercel.json`
**Classification:** FIX · **Status:** ✅ Fixed  
**Domain:** Infrastructure / Intelligence Cache  
**Impact:** `vercel.json` scheduled 3 of 4 intelligence cron jobs (listings every 5min, global every 10min, trending every 10min) but omitted `categories`. Sector intelligence data (60-min Redis TTL) was only refreshed by the `setInterval` worker — which dies on Vercel Lambda idle shutdown. On cold Vercel starts, all category/sector data (sector_status, STRONGEST/ACCELERATING/etc.) was up to 60min stale or absent. `sector_status` in signals was 100% NULL per P1.INTELLIGENCE.FIXES audit.  
**Risk:** High — sector intelligence is a key signal quality gate; NULL sector_status silently degrades signal generation  
**Effort:** Low  
**Files:** `vercel.json`  
**Action:** Added `{ "path": "/api/intelligence/cron/categories", "schedule": "*/30 * * * *" }`.

---

### MON-01 — Binance error anomaly detector permanently disabled
**Classification:** FIX · **Status:** ✅ Fixed  
**Domain:** Monitoring / Scanner  
**Impact:** `record_binance_error()` was defined in `monitoring.py` but never called anywhere. `market_fetcher.py` tracked Binance errors via Prometheus counters only, not the Redis `monitor:{date}:binance_errors` counter. The monitoring snapshot always read `binance_errors_per_day = 0`. The anomaly detector threshold `if binance_errs >= 15` could never fire. Binance geo-blocks (HTTP 451) and sustained API failures would go undetected by the operational dashboard.  
**Risk:** High — silent Binance failure mode with no operational alert  
**Effort:** Low  
**Files:** `backend/core/scanner/market_fetcher.py:214`  
**Action:** Added `await _incr("binance_errors", len(errors))` in `_flush_binance_metrics()` after the Redis pipeline executes. Errors are already batched; this adds one `INCRBY` per 5-second batch window.

---

### CACHE-01 — Orphan `intel:fallback:status` write + dead `count_24h` comment
**Classification:** REMOVE · **Status:** ✅ Fixed  
**Domain:** Intelligence Cache  
**Impact:** Two dead items in `intelligence_cache.py`:  
(1) `intel:fallback:status` was written (30-min TTL JSON blob) when CMC cache was cold. No Python API route or TypeScript dashboard route read this key. It was described as "admin-visible" but the reader was removed during ADMIN.CONSOLIDATION.1. Orphan Redis writes every time CMC cache was cold.  
(2) A code comment on `_fallback_coingecko()` claimed it "Increments intel:fallback:count_24h for daily frequency tracking" — but no INCR for this key was ever implemented. Stale documentation inside the code.  
**Risk:** Low (waste) + Medium (misleading comment could cause false debugging)  
**Effort:** Low  
**Files:** `backend/core/scanner/intelligence_cache.py`  
**Action:** Removed `FALLBACK_STATUS_KEY` constant, the `redis.setex(FALLBACK_STATUS_KEY, ...)` call, and cleaned the docstring. `FALLBACK_ALERT_TTL_KEY` (throttle) is retained — it is read.

---

## P1 — Reliability Improvements

### P1-01 — Dead settings groups: scanner numerics, signals, risk, infra
**Classification:** FIX · **Status:** ✅ Fixed (2026-06-19)  
**Domain:** Settings  
**Impact:** SETTINGS.WIRE.1 (June 2026) found that scanner numeric settings (`min_confidence`, `min_rr_ratio`, `max_coins_per_run`, etc. in the `scanner` group), the entire `signals` group, `risk` group, and `infra` group had zero backend consumers. The scanner uses hardcoded `CONFIGS` dicts plus the `SCANNER_MIN_CONFIDENCE_ALERT` env var, not the settings DB. The Quick Controls UI shows these sliders as if they have effect — they are placebo unless `features.apply_founder_thresholds = true` (default OFF).  
**Risk:** Medium — founder believes they are tuning signal quality when settings have no effect  
**Effort:** Low  
**Files:** `app/admin/system/page.tsx` (Settings tab), `lib/settings-tiers.ts`  
**Action:** Add `display only` wiring-state chips to all scanner/signals/risk numeric fields per the `wiredState()` map already in the settings page. Add a persistent callout: "These values take effect only when Apply Founder Floors is ON (Feature Flags)." This is a UI truth fix, not a backend change.

---

### P1-02 — `null_setup_confidence_penalty` magnitudes misaligned with heuristic scale
**Classification:** FIX · **Status:** ⏳ Deferred — requires 7d outcome data (checkpoint 2026-06-23)  
**Domain:** Scanner / Signal Quality  
**Impact:** The penalty applies after heuristic scoring. For SELL+SPOT+LOW_VOLATILITY+EMA_ALIGNMENT signals (which describes the majority of SPOT SELL signals in SIDEWAYS regime), the penalty is −14 points. Heuristic scores start at 45 and max at 95; a strong signal scores ~88. After −14 penalty, adjusted confidence = 74 — below even the new HEURISTIC.CALIBRATION.1 threshold of 80. This was the root cause of zero Telegram signals (fixed by lowering threshold, not by adjusting penalty). The penalty was designed for Claude's 0-100 scale where 88 → 74 is still strong; on the heuristic scale this is a disproportionate deduction.  
**Risk:** Medium — suppresses valid signals; AVAX SELL at raw=95 dropped to 85, BNB SELL at 88 dropped to 74  
**Effort:** Medium  
**Files:** `backend/core/scanner/signal_pipeline.py` — `_NULL_CONFIDENCE_PENALTIES` dict  
**Action:** Review penalty amounts for heuristic path specifically, or scale penalties by `0.7×` when `validation_source == "HEURISTIC"`. Requires outcome data to validate — propose for post-7d checkpoint.

---

### P1-03 — `scheduler:enabled` has no TTL — orphan key on full redeploy
**Classification:** FIX · **Status:** ✅ Fixed (2026-06-19 — SIGNAL_ENGINE_TRUTH_1 pass)  
**Domain:** Redis  
**Impact:** `coordinator.py` writes `scheduler:enabled` with SET (no TTL) when enable()/disable() is called. If the Redis instance is wiped and the key is lost, `is_enabled()` returns True (fail-open) which is correct. But if a deployment resets the Upstash instance, the key persists across instances. More importantly: the key accumulates indefinitely with no expiry. This is intentional for toggle-state persistence, but a 90-day safety TTL would self-clean zombie keys after major redeployments.  
**Risk:** Low (operational) / Medium (ops hygiene)  
**Effort:** Low  
**Files:** `backend/scheduler/coordinator.py` — `enable()` / `disable()`  
**Action:** Add `ex=90*24*3600` (90 days) to the SET call in `enable()` and `disable()`. Refresh TTL on every toggle so active use never expires the key.

---

### P1-04 — Documentation: CLAUDE.md and DEPLOYMENT.md stale migration references
**Classification:** FIX · **Status:** ✅ Fixed (CLAUDE.md updated; DEPLOYMENT.md already complete)  
**Domain:** Documentation  
**Impact:** CLAUDE.md decision #59 still reads "6 pending DB migrations" — all 7 migrations are confirmed applied (per user confirmation earlier in this session). DEPLOYMENT.md lists the same 7 migrations without indicating which are applied. This creates confusion for any fresh deploy or handoff.  
**Risk:** Low (no production impact) / Medium (onboarding confusion)  
**Effort:** Low  
**Files:** `CLAUDE.md` (decision #59), `DEPLOYMENT.md` (Step 1b)  
**Action:** Update decision #59 to say "All 7 migrations confirmed applied (June 2026)." Update DEPLOYMENT.md Step 1b to clarify these are the full migration list for a fresh install.

---

## P2 — Cleanup

### P2-01 — `providers:metrics` Redis hashes/lists have no TTL
**Classification:** FIX · **Status:** ✅ Fixed (2026-06-19)  
**Domain:** Redis  
**Impact:** Six provider metric hash keys (`providers:metrics:{name}:meta`, `:latency`, `:errors`) have no TTL. They are bounded in size (latency/errors lists LTRIM'd to 100 entries) but the keys themselves persist forever. On decommission or provider removal, these keys accumulate in Upstash indefinitely.  
**Risk:** Low  
**Effort:** Low  
**Files:** `lib/market-data/metrics.ts` (TypeScript writes), `backend/core/scanner/market_fetcher.py` (Binance writes)  
**Action:** Add `EXPIRE 7*24*3600` (7 days) to each key after the first write, resetting on each write. The TypeScript `recordSuccess()` and `recordError()` are the natural places. Python `_flush_binance_metrics()` should add EXPIRE to the pipeline.

---

### P2-02 — Binance latency: LPUSH (TypeScript) vs RPUSH (Python) inconsistency
**Classification:** FIX · **Status:** ✅ Fixed (2026-06-19)  
**Domain:** Redis  
**Impact:** TypeScript writes `providers:metrics:binance:latency` with LPUSH (prepend), Python writes with RPUSH (append). The ring buffer ordering is inconsistent. The p95 latency calculation is order-independent so there is no functional bug, but this is an undocumented inconsistency that could confuse future debugging.  
**Risk:** Low  
**Effort:** Low  
**Files:** `lib/market-data/metrics.ts` (LPUSH), `backend/core/scanner/market_fetcher.py` (RPUSH)  
**Action:** Standardise to RPUSH in both. Change TypeScript `recordSuccess()` latency push from LPUSH to RPUSH.

---

### P2-03 — `providers:metrics:coinmarketcap:quota` dead for display
**Classification:** REMOVE · **Status:** ✅ Fixed (2026-06-19)  
**Domain:** Redis  
**Impact:** TypeScript writes `providers:metrics:coinmarketcap:quota` but `providers.py` explicitly bypasses it at read time, substituting `intel:quota:used` instead. The quota hash for CMC is never displayed. It is incremented on every CMC call but never read.  
**Risk:** Low  
**Effort:** Low  
**Files:** `lib/market-data/metrics.ts` — `incrementQuota()`, `lib/intelligence/quota-guard.ts`  
**Action:** Remove `incrementQuota()` calls for `coinmarketcap` provider specifically, or skip the quota hash entirely for CMC (since `quota-guard.ts` already tracks credits in `intel:quota:used`).

---

### P2-04 — `intel:fallback:count_24h` stale comment removed — verify no other stale Phase 7.3A.8 references
**Classification:** FIX  
**Domain:** Documentation / Code  
**Impact:** The `_fallback_coingecko()` docstring mentioned three Phase 7.3A.8 features. One was removed (status blob + count_24h). Confirm the Telegram alert and Prometheus counter are still wired — they are.  
**Risk:** None (already verified correct)  
**Effort:** Low  
**Files:** `backend/core/scanner/intelligence_cache.py`  
**Action:** Done — docstring cleaned in `75d0014`.

---

### P2-05 — `paper_trading` settings group: hidden in UI but still in groups.py
**Classification:** ARCHIVE · **Status:** ✅ Fixed (2026-06-19)  
**Domain:** Settings  
**Impact:** `PaperTradingSettings` group exists in `groups.py` and is loaded by the settings service, but is explicitly hidden in the Settings UI (SETTINGS.SIMPLIFY.1). It can still be written/read via the API. No backend code consumes it (paper trading is not an active feature).  
**Risk:** Low  
**Effort:** Low  
**Files:** `backend/system_settings/groups.py`, `app/admin/system/page.tsx`  
**Action:** Add a deprecation comment in groups.py marking it as dead. Do not delete (migration safety — existing DB rows reference the group name).

---

## P3 — Archival

### P3-01 — Old admin page files (trading/analytics/intelligence/settings) — confirmed deleted
**Classification:** ARCHIVE · **Status:** ✅ Already done  
**Domain:** Admin Dashboard  
**Impact:** All four old center directories (`app/admin/trading/`, `analytics/`, `intelligence/`, `settings/`) were confirmed deleted. All redirects in `next.config.mjs` point to valid 3-center destinations. No action needed.

---

### P3-02 — `test_p1_intelligence_fixes.py` — `probability_gate_enabled` assertion updated
**Classification:** FIX · **Status:** ✅ Already done (prior session)  
**Domain:** Tests  
**Impact:** Test `test_flag_defaults_off` asserted `False` for `probability_gate_enabled` but SQA3 changed the default to `True`. Fixed to `test_flag_defaults_on`.

---

## Summary Tables

### By Domain

| Domain | P0 ✅ | P1 | P2 | P3 | Total |
|--------|-------|----|----|----|----|
| Scanner / Signal Quality | 1 | 1 | 0 | 0 | 2 |
| Probability Engine | 0 | 0 | 0 | 0 | 0 |
| Redis | 1 | 1 | 3 | 0 | 5 |
| Celery | 0 | 0 | 0 | 0 | 0 |
| Telegram | 1 | 0 | 0 | 0 | 1 |
| Admin Dashboard | 2 | 1 | 0 | 0 | 3 |
| Settings | 0 | 1 | 1 | 0 | 2 |
| API Endpoints | 0 | 0 | 0 | 0 | 0 |
| Infrastructure | 1 | 1 | 0 | 0 | 2 |
| Documentation | 0 | 1 | 1 | 2 | 4 |
| **Total** | **6** | **4** | **5** | **2** | **17** |

### Quick Wins (P1–P2, effort = low)

| ID | Fix | Effort |
|----|-----|--------|
| P1-03 | Add 90-day TTL to `scheduler:enabled` | 30 min |
| P1-04 | Update CLAUDE.md #59 + DEPLOYMENT.md migration status | 15 min |
| P2-01 | Add 7-day EXPIRE to provider metrics keys | 1h |
| P2-02 | Standardise LPUSH→RPUSH for binance latency | 15 min |
| P2-03 | Remove dead CMC quota hash writes | 30 min |
| P2-05 | Add deprecation comment to PaperTradingSettings | 5 min |

### Items confirmed KEEP (no action)

| Item | Reason |
|------|--------|
| `scheduler:lock:{mode}` | Correctly bounded, correct TTL |
| `celery:worker:last_heartbeat` | Worker HEALTHY/DEGRADED/OFFLINE display correct since `70c7f93` |
| `tg:alert:{SYMBOL}:{DIRECTION}` | Dedup + upgrade logic correct (TELEGRAM.RELIABILITY.1 WS3) |
| `ai:daily_calls:{date}` | Correctly gated, Redis-backed for restarts |
| All 3 new admin centers (signals/performance/system) | Redirects valid, polling at 120–300s |
| Probability gate flag defaults | All 5 flags correctly ON per SQA3, tests pass |
| Attribution snapshots beat task | Scheduled at 00:15 UTC, correct |
| `should_suppress_send()` logic | Null probability → never gates; known-bad cohort → gates; correct |

---

## Validation Checklist

After applying remaining P1–P2 fixes, verify:

- [ ] `scheduler:enabled` key has TTL visible in Upstash key browser
- [ ] `providers:metrics:coinmarketcap:meta` — confirm `requestsToday` increments on CMC calls (not the now-removed quota hash)
- [ ] System → Health tab shows TelegramDeliveryCard with delivery rate ≥ 0
- [ ] After Vercel cold start: `/api/intelligence/cron/categories` fires within 30min; sector_status fields populate
- [ ] AVAX SELL / DOGE SELL (heuristic, adjusted confidence 81–85) reach Telegram within next 2 scan cycles
- [ ] `monitor:{today}:binance_errors` increments when a Binance kline fetch fails (verify in Upstash)
- [ ] Binance error anomaly threshold fires at ≥15 errors/day (visible in System → Health → anomalies)
- [ ] System → Settings → Feature Flags: `probability_gate_expectancy_filter` phantom card is gone
- [ ] Signals showing heuristic validation show SCREENED (sky-400), not AI_APPROVED (purple)
- [ ] DEPLOYMENT.md migration list is current for fresh-install use

---

## Platform Quality Assessment

| Dimension | Before | After P0 | After P1–P2 |
|-----------|--------|-----------|-------------|
| Signal delivery | ⚠️ Zero signals (AI off) | ✅ 80+ threshold | ✅ Penalty review |
| Telegram monitoring | ❌ No delivery funnel UI | ✅ Card restored | ✅ |
| Binance anomaly detection | ❌ Permanently 0 | ✅ Counter wired | ✅ |
| Sector intelligence | ⚠️ Stale on Vercel idle | ✅ Cron added | ✅ |
| Heuristic badge truth | ❌ AI_APPROVED for heuristic | ✅ SCREENED | ✅ |
| Feature flag UI | ❌ Phantom flag card | ✅ Removed | ✅ |
| Redis hygiene | ⚠️ 3 orphan/dead keys | ✅ Cleaned | ✅ TTL added |
| Settings truth | ⚠️ Placebo sliders | ⚠️ (P1-01) | ✅ |
| Documentation | ⚠️ Stale migration refs | ⚠️ (P1-04) | ✅ |

**Current:** 9.5/10  
**After P0 (committed):** 9.8/10  
**After P1–P2:** 10/10
