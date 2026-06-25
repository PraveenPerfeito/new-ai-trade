# PROJECT HISTORY
<!-- Consolidated from: DOCUMENT_CONSOLIDATION_1, all phase docs, CLAUDE.md phase history, commit references across all docs -->
<!-- Last updated: 2026-06-23 · Authoritative source for phase timeline, decisions, supersession chain, open items -->

---

## SECTION 1 — Phase Timeline

| Phase | Date | Description | Status |
|-------|------|-------------|--------|
| Phase 1–5 | 2025 | Initial scanner, CMC integration, TypeScript scanner, basic admin | COMPLETE |
| Phase 6 | Early 2026 | Futures intelligence, OI, positioning, breakout | COMPLETE |
| **Phase 7.2B** | May 2026 | Founder Settings & Operations Simplification | COMPLETE |
| **Phase 7.3A** | May 2026 | CMC Intelligence Pipeline + Trending Universe Fusion + 10 new intelligence modules | COMPLETE |
| **Phase 7.4A** | May 2026 | Breakout + OI + Positioning Intelligence | COMPLETE |
| Phase 7.4A.6 | May 2026 | Claude Institutional Context Upgrade | COMPLETE |
| Phase 7.4A.7 | May 2026 | TrendScore + Sector Signal Propagation | COMPLETE |
| **Phase 8.1D / PROD.FIX.1** | June 2026 | Production hardening — 16 fixes P0–P3 | COMPLETE |
| Phase 9.P0 | June 2026 | P0 hardening: output collapse, early breakout penalty, attribution snapshots, kline telemetry | COMPLETE |
| **Phase 9.P1** | June 2026 | Probability Engine (empirical grades, cohort hierarchy, track record endpoint) | COMPLETE |
| Phase 9.P1 cont. | June 2026 | P1 Intelligence Fixes (funding threshold, sector propagation, high_confidence flag) | COMPLETE |
| **RISKGRADE.FIX.1** | June 2026 | Grade recalibration: penalty 5→2, breakout bonus, regime adjustment | COMPLETE (commit `1ad5ef2`) |
| **ALPHA.TRUTH.1** | June 2026 | NULL regime hard gate, OI_NEUTRAL restored, futures penalty→0.0 | COMPLETE (commits `70af050`, `11a3133`) |
| MARKET_STRUCTURE.FIX.1 | June 2026 | Regime-aware thresholds (F4/F6), sub-condition telemetry | COMPLETE (commit `405c11f`) |
| SIGNAL.QUALITY.1 | June 2026 | Structure-aware stops, ADX scoring, volume gradient, RSI pullback zones | COMPLETE (commit `3f36d65`) |
| SIGNAL.QUALITY.2 | June 2026 | 4h MACD/RSI, daily candle bonus | COMPLETE (commit `638452e`) |
| SIGNAL.QUALITY.3 | June 2026 | RSI divergence, counter-EMA200 penalty, CMC direct fallback, TELEGRAM_SENT stage | COMPLETE |
| ADMIN.CONSOLIDATION.1 | June 2026 | 13 pages → 4 centers | COMPLETE (superseded by 3-center) |
| PLATFORM.SIMPLIFICATION.1 | June 2026 | 4 centers → 3 centers (current) | COMPLETE (branch `feat/platform-simplification-1`) |
| OPS.CONSOLIDATION.1 | June 2026 | Redis <200K ops/month target, CloudAMQP broker, kline batching | COMPLETE |
| TELEGRAM.RELIABILITY.1 | June 2026 | WS1–WS5 delivery fixes (queue drain, ground truth, dedup fix, semaphore fix) | COMPLETE |
| SETTINGS.WIRE.1 | June 2026 | Founder floors + settings wiring truth | COMPLETE |
| SETTINGS.SIMPLIFY.1 | June 2026 | Founder Control Center — 5 sections → 3 sections | COMPLETE |
| VALUE.SURFACING.1+2 | June 2026 | 23 orphaned fields surfaced in UI (zero new API/DB) | COMPLETE (commits `969d430`, `d637674`) |
| VALUE.SURFACING.3 | June 2026 | Liquidation zones, per-coin performance table | COMPLETE (commit `cc3a63f`) |
| PERFORMANCE.VERIFICATION.1 | June 2026 | Probability accuracy/grade validation read-only analytics | COMPLETE |
| CONFIDENCE.CALIBRATION.2 | June 2026 | Empirical confidence bands (flag OFF by default) | COMPLETE |
| UI.UX.MODERNIZATION.1 | June 2026 | 25-item visual polish pass (zero logic changes) | COMPLETE (commit `498ca4a`) |
| **SIGNAL.QUALITY.AUDIT.3** | June 2026 | 5 P0 flags applied; Feature Flags UI overhaul | COMPLETE (commits `caa3948`, `acb1514`) |
| **PLATFORM.STABILIZATION.1** | June 2026 | All P0/P1/P2 platform bugs resolved (9.5/10 → 9.8/10) | COMPLETE (commit `75d0014`) |
| PRODUCTION.TRUTH.VERIFICATION.1 | June 2026 | 9-phase data integrity audit (64 findings) | COMPLETE |
| PRODUCTION.TRUTH.FIXES.1 | June 2026 | All P0 bugs fixed (11 items) | COMPLETE |
| FRONTEND.SYSTEM.TRUTH.1 | June 2026 | 38-finding frontend number audit (13 P0, 20 P1, 8 P2) | COMPLETE |
| FRONTEND.SYSTEM.TRUTH.FIXES.1–4 | June 2026 | All 38 findings resolved, dashboard 7.5→9.9/10 | COMPLETE |
| STABILIZATION.CLOSEOUT.1 | June 2026 | Final closeout — platform frozen June 22 | COMPLETE |
| **SIDEWAYS.REGIME.DECISION.1** | June 23, 2026 | SIDEWAYS hard gate: n=361, WR=30.47% → block | COMPLETE (commit `38b52fb`) |
| **SIDEWAYS.EXEMPTION.1** | June 23, 2026 | CONFIRMED_BREAKOUT exemption from SIDEWAYS gate | COMPLETE (commit `d0f949a`) |
| VOLUME.QUALITY.BALANCE.1 | June 23, 2026 | Volume/quality audit confirming healthy filtering | COMPLETE |
| **ALPHA.MONITORING.1** | June 23–30, 2026 | 7-day monitoring freeze | IN PROGRESS |
| DOCUMENT.CONSOLIDATION.FINAL.1 | June 23, 2026 | 24 docs → 6 master documents | COMPLETE (this file) |

---

## SECTION 2 — Architecture Decision Log

Key decisions that are non-obvious or contradict default assumptions:

| Decision | What | Why |
|----------|------|-----|
| Python scanner PRIMARY | All new scanner features in `backend/core/scanner/`. TypeScript `lib/scanner.ts` is legacy. | Python enables Redis intelligence cache, Celery batching, proper concurrency |
| CMC primary (not CoinGecko) | 200 coins in 1 API call | CoinGecko is fallback only; CMC provides consistent rank/sector data |
| `globalThis` scheduler | Survives Next.js HMR | Prevents duplicate timers on hot reload |
| CloudAMQP broker | Eliminates 34,560 Redis BLPOP ops/day | Redis Cloud Essentials had connection pressure from BLPOP |
| `rpc://` result backend | Zero Redis for task results | No code calls `AsyncResult.get()` on scheduled results |
| SchedulerCoordinator fail-open | Redis errors → return True (enabled) | Scanner must continue during Redis quota exhaustion |
| OI_NEUTRAL fail-open | n<30 → probability gate passes | WR=76.3% — cannot afford to block; better to err on deliver |
| AI check by class not string | `get_group(AISettings)` not `get_group("ai")` | String causes silent TypeError → setting never read |
| `status_async()` not `status()` | FastAPI callers must use async variant | `status()` calls `asyncio.run()` → RuntimeError in running event loop |
| NULL regime hard gate | `if not btc_regime: return None` | n=677 NULL signals had WR=14.9% — worst cohort in system |
| VALIDATED stage unreachable | Every persisted signal is at least SCREENED | SCREENED is the minimum state post-pipeline |
| WhatsApp = "Telegram" in code | UltraMsg delivery but source code uses Telegram | Historical — platform migrated after code was written; never renamed in source |

---

## SECTION 3 — Supersession Chain

| Old Document/Phase | Superseded By | Status |
|--------------------|---------------|--------|
| TypeScript scanner (primary) | Python backend scanner | Python is PRIMARY; TS is LEGACY |
| REDIS_OPTIMIZATION_AUDIT.md | OPS_CONSOLIDATION_1.md | Archive |
| PLATFORM_AUDIT.md | ADMIN_CONSOLIDATION_1 → PLATFORM_SIMPLIFICATION_1 | Archive |
| ADMIN_CONSOLIDATION_1.md | PLATFORM_SIMPLIFICATION_1 (3 centers) | Archive |
| PLATFORM_SIMPLIFICATION_1.md (planning) | Current `app/admin/` structure | Archive (planning doc, implementation complete) |
| DEPLOYMENT.md | MASTER_PLATFORM_STATUS.md §Deployment | Update stub |
| RISKGRADE_FIX_1 (penalty 5→2) | ALPHA.TRUTH.1 (penalty→0.0) | Superseded; F1 targets void |
| PRD.md | CLAUDE.md + master docs | Historical reference only |
| 4-center admin structure | 3-center admin structure | Old URLs 301/302 redirect |
| `high_confidence` mode | FLAG OFF pending 30+ outcomes at WR≥40% | Paused, not deleted |
| 13 individual admin pages | 4 centers → 3 centers | All redirect via next.config.mjs |

---

## SECTION 4 — Open Items Register

### P0 — Act within 24h
| ID | Item | Location |
|----|------|----------|
| P0-INF-2 | Set ANTHROPIC_API_KEY in Railway | Railway env vars |

### P1 — Act within 7 days (post June 30)
| ID | Item | Source | Notes |
|----|------|--------|-------|
| P1-GATE-1 | BULL_TREND gate: WR=21.65%, Exp=−0.330R, n=97 | SIGNAL_ENGINE_MASTER §9 | Implement only after D7 measurement |
| P1-DB-1 | `telegram_delivered=NULL` for pre-WS2 signals | INFRASTRUCTURE_MASTER §7 | Expected state — ~626 signals pre-fix |
| P1-UI-1 | No CMC cache manual refresh UI entry point | PLATFORM_TRUTH_MASTER §4 | Deleted in PLATFORM_SIMPLIFICATION_1 |
| P1-PERF-1 | Probability accuracy MAE=40.9pp | SIGNAL_PERFORMANCE_MASTER §5 | Monitor; no action until ≥200 stamped |
| P1-TEST-1 | `test_probability_engine.py:129` — `riskgrade_v2` default `OFF` in test but `ON` in production | `backend/analytics/tests/test_probability_engine.py:129` | Update test default to `True` |

### P2 — Act within 30 days
| ID | Item | Source |
|----|------|--------|
| P2-DOC-1 | DOCUMENT_CONSOLIDATION_1 C1 — DEPLOYMENT.md stale (missing 6 migrations) | DEPLOYMENT.md | Update stub |
| P2-PERF-1 | TRENDING mode WR=28.2% (negative expectancy 30D) | SIGNAL_PERFORMANCE_MASTER §6 | Probability gate blocks delivery correctly |
| P2-OPS-1 | Redis actual ops ~1.32M/month vs 200K target | INFRASTRUCTURE_MASTER §5 | Re-evaluate plan limits |

---

## SECTION 5 — Contradictions Resolved

From DOCUMENT_CONSOLIDATION_1 audit (June 17):

| ID | Contradiction | Resolution |
|----|--------------|------------|
| C1 | DEPLOYMENT.md missing 6 DB migrations (only listed 1 of 7) | 7 migrations confirmed applied June 16; DEPLOYMENT.md is stale |
| C2 | CLAUDE.md §7 says "Admin → System → Settings → Quick Controls" but old setting was elsewhere | Confirmed: Current location IS System → Settings → Quick Controls |
| C3 | RISKGRADE.FIX.1 said futures penalty 5→2; ALPHA.TRUTH.1 set it to 0.0 | ALPHA.TRUTH.1 supersedes FIX.1; penalty is 0.0 in current code |
| C4 | `test_probability_engine.py:129` — `riskgrade_v2` default OFF in test, but default is now ON | Test needs updating (P1-TEST-1) |
| C5 | SYSTEM_STABILIZATION_FINAL estimated Redis ~66K ops/month; CMC_REDIS_TRUTH_1 found ~1.32M/month | CMC_REDIS_TRUTH_1 is the accurate audit; SYSTEM_STABILIZATION_FINAL used wrong multiplier |
| C6 | Multiple docs say "Telegram alerts" but platform uses WhatsApp (UltraMsg) | WhatsApp is correct; source code says "Telegram" because it was never renamed |
| C7 | PROD.FIX.1 said production readiness 9.5/10; PLATFORM_STABILIZATION_1 said 9.8/10 | Both correct for different scopes; overall current estimate ~9.5/10 (infrastructure gap) |
| C8 | ADMIN.CONSOLIDATION_1 described 4 centers; current is 3 centers | PLATFORM.SIMPLIFICATION.1 superseded 4-center structure |
| C9 | PRD.md v1.2 listed 4 operating modes; high_confidence is now paused | PRD.md is stale; current active modes: spot, futures, trending |
| C10 | Value Surfacing docs said "Zero backend changes" but CMC direct fallback was backend | SIGNAL.QUALITY.3 included backend fallback — mislabeled as UI-only |

---

## SECTION 6 — Document Migration Table

| Source File | Destination | Action |
|-------------|-------------|--------|
| `ALPHA_MONITORING_1.md` | `SIGNAL_PERFORMANCE_MASTER.md` | Archive |
| `CMC_REDIS_TRUTH_1.md` | `INFRASTRUCTURE_MASTER.md` | Archive |
| `DEPLOYMENT.md` | `MASTER_PLATFORM_STATUS.md` §Deployment | Update in place (stub) |
| `DOCUMENT_CONSOLIDATION_1.md` | `PROJECT_HISTORY.md` | Archive |
| `FRONTEND_SYSTEM_TRUTH_1.md` | `PLATFORM_TRUTH_MASTER.md` | Archive |
| `FRONTEND_SYSTEM_TRUTH_FIXES_1.md` | `PLATFORM_TRUTH_MASTER.md` | Archive |
| `LIVE_RECOVERY_MONITOR_1.md` | `SIGNAL_PERFORMANCE_MASTER.md` | Archive |
| `MASTER_PLATFORM_STATUS.md` | `MASTER_PLATFORM_STATUS.md` | Updated in place |
| `PLATFORM_STABILIZATION_1.md` | `PLATFORM_TRUTH_MASTER.md` + `MASTER_PLATFORM_STATUS.md` | Archive |
| `POST_DEPLOY_RECOVERY_MEASUREMENT_1.md` | `SIGNAL_PERFORMANCE_MASTER.md` | Archive |
| `PRODUCTION_TRUTH_FIXES_1.md` | `PLATFORM_TRUTH_MASTER.md` | Archive |
| `PRODUCTION_TRUTH_VERIFICATION_1.md` | `PLATFORM_TRUTH_MASTER.md` | Archive |
| `PROFIT_PRESERVATION_1.md` | `SIGNAL_PERFORMANCE_MASTER.md` | Archive |
| `RECOVERY_READINESS_CHECK_1.md` | `SIGNAL_PERFORMANCE_MASTER.md` | Archive |
| `RECOVERY_VALIDATION_DAY7_1.md` | `SIGNAL_PERFORMANCE_MASTER.md` | Archive |
| `SIDEWAYS_EXEMPTION_1.md` | `SIGNAL_ENGINE_MASTER.md` | Archive |
| `SIDEWAYS_REGIME_DECISION_1.md` | `SIGNAL_ENGINE_MASTER.md` | Archive |
| `SIGNAL_ENGINE_ACTIONS_1.md` | `SIGNAL_ENGINE_MASTER.md` | Archive |
| `SIGNAL_ENGINE_TRUTH_1.md` | `SIGNAL_ENGINE_MASTER.md` | Archive |
| `SIGNAL_QUALITY_AUDIT_3.md` | `SIGNAL_ENGINE_MASTER.md` | Archive |
| `SIGNAL_QUALITY_END_TO_END_VALIDATION_1.md` | `MASTER_PLATFORM_STATUS.md` | Archive |
| `STABILIZATION_CLOSEOUT_1.md` | `PLATFORM_TRUTH_MASTER.md` + `MASTER_PLATFORM_STATUS.md` | Archive |
| `SYSTEM_STABILIZATION_FINAL_1.md` | `MASTER_PLATFORM_STATUS.md` + `INFRASTRUCTURE_MASTER.md` | Archive |
| `VOLUME_QUALITY_BALANCE_1.md` | `SIGNAL_ENGINE_MASTER.md` | Archive |
| `ADMIN_CONSOLIDATION_1.md` | `PROJECT_HISTORY.md` (supersession chain) | Archive |
| `PLATFORM_SIMPLIFICATION_1.md` | `PROJECT_HISTORY.md` (supersession chain) | Archive (planning doc) |
| `REDIS_OPTIMIZATION_AUDIT.md` | `INFRASTRUCTURE_MASTER.md` | Archive (superseded by OPS_CONSOLIDATION_1) |
| `PLATFORM_AUDIT.md` | `PROJECT_HISTORY.md` | Archive |

---

## SECTION 7 — Technology Stack Summary

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Next.js 14 App Router + TypeScript + Tailwind | Deployed on Vercel |
| Auth | Supabase Auth + @supabase/ssr | Two-layer: Edge middleware + FastAPI AdminAuthMiddleware |
| Database | Supabase PostgreSQL + asyncpg | 7 migrations applied |
| AI | Anthropic Claude Haiku | Currently unset (100% heuristic) |
| Backend | Python FastAPI + Celery | Deployed on Railway |
| Message broker | CloudAMQP (AMQP) | Replaces Redis BLPOP |
| Result backend | `rpc://` | Zero Redis for task results |
| Cache | Redis Cloud Essentials | 50 keys, ~44K ops/day |
| Signal delivery | UltraMsg (WhatsApp) | WS1-WS5 reliability fixes applied |
| Market data | CoinMarketCap (primary) + Binance + CoinGecko (fallback) | TypeScript cron writes Redis; Python reads cache |
| Real-time news | xAI Grok-2 (deleted) | XAI_API_KEY unset; News tab removed |

---

## SECTION 8 — Key Numbers Reference

| Metric | Value | Notes |
|--------|-------|-------|
| Active scan modes | 3 (spot, futures, trending) | high_confidence paused |
| Coins scanned per scan | Up to 80/50/80 per mode | CMC top-200 universe |
| DB migration count | 7 (all applied) | Idempotent IF NOT EXISTS |
| Feature flags in `features` group | 20 total | 5 P0 flags changed June 16 |
| Admin centers | 3 | /admin/signals, /performance, /system |
| Admin tabs total | 9 | (was 25 pre-consolidation) |
| Signal pipeline gates | 13 + 1 delivery | Ordered in SIGNAL_ENGINE_MASTER §1 |
| Redis keys | 50 | KEEP 44, OPTIMIZE 6 |
| Attribution snapshot rows | 1,243 | Powers probability gate |
| DB migrations applied | 7/7 | All idempotent |
| CMC API usage | ~216 credits/day | 2.2% of 300K budget |
| WhatsApp dedup TTL | 1h per symbol+direction | Direction flip delivers immediately |
| Recovery Score (D7) | 7.85/10 | Decision: CONTINUE |
| Platform score | ~9.5/10 | 2 P0 infrastructure gaps |
