# PLATFORM TRUTH MASTER
<!-- Consolidated from: FRONTEND_SYSTEM_TRUTH_1, FRONTEND_SYSTEM_TRUTH_FIXES_1, PRODUCTION_TRUTH_VERIFICATION_1, PRODUCTION_TRUTH_FIXES_1, SYSTEM_STABILIZATION_FINAL_1, STABILIZATION_CLOSEOUT_1, PLATFORM_STABILIZATION_1 -->
<!-- Last updated: 2026-06-23 · Authoritative source for settings wiring, count truth, lifecycle stages, and frontend accuracy -->

---

## SECTION 1 — Settings Wiring Truth

### WIRED — backend actively reads and uses
| Setting | Key | Consumer | Behavior |
|---------|-----|----------|---------|
| AI toggle | `ai.enabled` | `ai_validator.py` | Gate switch — OFF → 100% heuristic |
| AI max tokens | `ai.max_tokens` | `ai_validator.py` | 768 floor enforced (avg completion ~625 tokens) |
| WhatsApp alerts | `telegram.alerts_enabled` | `telegram_notifier.py` | Gate switch — OFF → no delivery |
| Ops alerts | `telegram.ops_alerts_enabled` | `telegram_notifier.py` / `_ops_alerts_enabled()` | Default false; gates all non-signal alerts |
| Anomaly settings | `anomaly.*` | `propagation.py` → `anomaly_detector.configure()` | Hot-swap on change, pub/sub propagates |
| Feature flags | `features.*` | `_check_operational_flags()` in every scanner step | Checked per-coin (NOT per-scan) |
| Trending watchlist | `scanner.trending_watchlist` | `trending_universe.py` | Watchlist coins included in trending mode |
| Founder floors | `scanner.min_confidence`, etc. | `apply_founder_floors()` in `orchestrator.py` | Only when `features.apply_founder_thresholds=ON` |

### FLOOR — wired only when `apply_founder_thresholds=ON`
| Setting | Key | Behavior |
|---------|-----|---------|
| `scanner.min_confidence` | Quick Controls value | `max()` applied to per-mode CONFIGS |
| `scanner.alert_confidence` | Quick Controls value | `max()` applied to per-mode CONFIGS |
| `scanner.max_coins_per_run` | Quick Controls value | `min()` applied to per-mode CONFIGS |
| `signals.min_rr_ratio` | Quick Controls value | `max()` applied to per-mode CONFIGS |

Floors can tighten but NEVER loosen below ALPHA.TRUTH.1 per-mode minimums.

### DISPLAY-ONLY — stored but not read by scanner/AI
| Group | Keys | Notes |
|-------|------|-------|
| `ai` | `temperature`, `timeout_secs` | Stored; Python scanner uses hardcoded defaults |
| `scanner` | `delay_ms`, `volume_spike_threshold`, `rsi_*`, all numerics except `min_confidence` | Scanner reads hardcoded `CONFIGS` dict |
| `signals` | ALL keys including `min_rr_ratio` (unless floors ON) | No scanner consumer |
| `risk` | ALL keys | Risk engine reads hardcoded thresholds |

### DEAD — stored but zero consumers anywhere
| Group | Keys |
|-------|------|
| `paper_trading` | All keys |
| `signals` | `confidence_high`, `confidence_medium` |

### DEAD — removed from UI but may exist in DB
| Key | Notes |
|-----|-------|
| `infra.*` | Shown read-only in System → Health → InfraConfigSection |
| `quota.*`, `providers.*`, `market_cache.*` | Not settings groups — env/code-controlled |

**Important:** Settings read with wrong type fail silently. Always pass model class: `get_settings_service().get_group(AISettings)` — NOT `get_group("ai")`.

---

## SECTION 2 — Count Consistency Truth

All counts are DB-authoritative post-FRONTEND.SYSTEM.TRUTH.FIXES. Redis counters are fallback only.

| Count | Source | API | Cadence |
|-------|--------|-----|---------|
| `signals_today` | DB: `signals` where `created_at > now-24h` | `/api/signals/counts` | Per request |
| `active_signals` / `open_signals` | DB: 7D signals minus TP_HIT/SL_HIT/TIMEOUT resolved (includes STALE — past window but unresolved). Differs from ACTIVE stage (within window only). Both field names returned; `open_signals` is the clearer alias. | `/api/signals/counts` | Per request |
| `win_rate_7d` | DB: `signal_outcomes` `rr_achieved > 0 / total` | `/api/signals/counts` | Per request |
| `expectancy_7d` | DB: canonical `winRate×avgWin − lossRate×avgLoss` | `/api/signals/counts` | Per request |
| `signals_per_day` | DB: rolling 24h count (Redis `monitor:{today}:signals` is fallback) | `/api/analytics/monitor` | Per request |
| `telegram_sends_per_day` | DB fallback: rolling 24h from `signals.telegram_delivered` (Redis UTC-day counter is unreliable) | `/api/analytics/monitor` | Per request |
| `scans_today` | Redis `monitor:{today}:scans` | `/api/analytics/monitor` | Per request |

### PostgREST subquery fix (active)
`/api/signals/counts` — active_signals cannot use `.not('id','in','(select signal_id ...)')` — PostgREST does NOT support SQL subqueries in filter values. Fix: two-step query (fetch IDs first, then `.in('signal_id', ids).neq('outcome','PENDING')`).

---

## SECTION 3 — Signal Lifecycle Stages

All 10 stages defined in `STAGE_META` in `app/admin/signals/page.tsx`.
`computeLifecycleStage()` in `lib/signal-lifecycle.ts`.

| Stage | Color | Condition | Reachable? |
|-------|-------|-----------|-----------|
| VALIDATED | amber | Persisted signal, no other criteria | **UNREACHABLE** — every persisted signal has at least SCREENED/AI_APPROVED |
| **SCREENED** | sky-400 | `validation_source === 'HEURISTIC'` | Yes — all current signals (AI off) |
| **AI_APPROVED** | purple | `validation_source === 'AI'` | Only when AI on + setup_score ≥ 78 |
| TELEGRAM_SENT | blue | `telegram_sent=true + within 30 min of send` | Yes |
| ACTIVE | emerald | `telegram_sent=true + within timeframe window` | Yes |
| STALE | zinc | `telegram_sent=true + past timeframe window` | Yes |
| TP_HIT | green | `outcome === 'TP_HIT'` | Yes |
| SL_HIT | red | `outcome === 'SL_HIT'` | Yes |
| ANALYZED | blue-gray | `outcome === 'ANALYZED'` | Yes but rare |
| CLOSED | gray-600 | `outcome === 'CLOSED'` OR `outcome === 'TIMEOUT'` | Yes |

**Note:** `TIMEOUT` is a DB outcome value (signal expired without resolution), not a lifecycle stage. `computeLifecycleStage()` maps `outcome === 'TIMEOUT'` → `CLOSED` stage.

**Timeframe windows for ACTIVE:**
- 1h signals: 8h window
- 4h signals: 24h window
- 1d signals: 72h window

**TELEGRAM_SENT vs ACTIVE:** First 30 min after send → TELEGRAM_SENT. After 30 min within window → ACTIVE. After window → STALE.

**`isActiveStage()` includes:** SCREENED, AI_APPROVED, TELEGRAM_SENT, ACTIVE (shown in active preset filter).

---

## SECTION 4 — Admin Center Structure (current)

3 centers (from PLATFORM.SIMPLIFICATION.1, current):

| URL | Tabs | Description |
|-----|------|-------------|
| `/admin/signals` | Overview · Signals · Regime | Trading overview, signal feed, regime state |
| `/admin/performance` | Track Record · Edge · Attribution | Outcome analytics, edge validation, attribution |
| `/admin/system` | Health · Anomalies · Settings | Service health, anomaly action center, founder settings |

**Redirects in `next.config.mjs`:**
- `/admin/trading` → `/admin/signals`
- `/admin/analytics` → `/admin/performance`
- `/admin/intelligence` → `/admin/system?tab=system`
- `/admin/settings` → `/admin/system?tab=settings`

**AI toggle location:** System → Settings → Quick Controls
**WhatsApp toggle location:** System → Settings → Quick Controls
**Feature flags location:** System → Settings → Feature Flags (NOT duplicated in Health tab — SYSTEM.DIAGNOSTICS.1 removed the duplicate)
**CMC cache refresh:** No UI entry point (deleted in PLATFORM.SIMPLIFICATION.1) — must call backend API manually if needed

---

## SECTION 5 — Frontend Number Accuracy

**Dashboard Truth Score: 9.9/10** (post-FRONTEND.SYSTEM.TRUTH.FIXES.1-4, June 22)

All 38 audit findings from FRONTEND_SYSTEM_TRUTH_1 resolved. Key fixes:

### Signals Page
| Finding | Fix |
|---------|-----|
| Counts capped at 200-signal feed | DB-authoritative counts via `/api/signals/counts` |
| Screened chip = population math (wrong) | Now filter by `lifecycleStage === 'SCREENED'` |
| Dead polling (auditEntries, healthReady never rendered) | Removed dead polls |
| LifecycleFunnel "Generated" capped at 200 | Pass `dbTotal` to funnel |
| LifecycleFunnel double-counted TELEGRAM_SENT | Remove TELEGRAM_SENT from active filter |
| `flags.telegram` always false | Fetch `telegram` group; read `alerts_enabled` |
| Tactical route outcomes non-deterministic | Add `.neq('outcome','PENDING')` filter |
| BUY/SELL confidence distribution (`signals.length`) | Use `nonPresetFiltered` count |

### Performance Page
| Finding | Fix |
|---------|-----|
| Edge Regime Performance groups by `volatility_regime` | Rewrote `market_regime_analysis()` to use `market_regime` |
| gradeOrder includes non-existent grades (A+, B+) | Changed to `['A', 'B', 'C', 'D', 'F']` only |
| Track Record excludes TIMEOUT from WR denominator | TIMEOUT included in WR calculation |
| Track Record uses non-canonical expectancy | Canonical formula: `winRate×avgWin − lossRate×avgLoss` |
| WrSparkBar 0-100 scale wrong | Fixed scale |
| CMC cache age using formatted TTL | Now uses raw TTL seconds |

### System Page
| Finding | Fix |
|---------|-----|
| `not_configured` treated as allHealthy=true | `not_configured` excluded from `allHealthy` check |
| scans_today hardcoded "healthy" (never warned) | Added THRESHOLDS entry: warn <8, critical <2 |
| Anomaly "Monitored Checks" list wrong | Now matches actual backend types (4 checks) |
| WhatsApp Delivery % wrong denominator | Fixed: `telegram_sent` / `generated` |
| SystemStatusBanner `flags.telegram` always false | Fixed by fetching correct settings group |
| Worker shows DOWN when HEALTHY | Fixed: `checks.celery_worker === 'HEALTHY'` not `=== 'ok'` |

---

## SECTION 6 — Remaining Open Items

All P1/P2 items from June 22 audit resolved (June 24):

| ID | Item | Resolution |
|----|------|-----------|
| SIGCNT-A3 | Mode filter client-side only (signals #201+ absent with filter) | Fixed: mode/type filters moved to DB level in `getRecentSignals()` |
| APIC-F3 | Tactical route outcome error not surfaced | Fixed: `outcomesAvailable` flag in tactical route + amber banner in UI |
| FG-03 | `active_signals` definition ambiguity | Fixed: `open_signals` alias added with clarifying comment in counts route |
| SIGCNT-A6 | "Sent" defined 3 different ways on same page | Fixed: overview metric → "Sent (7d)", preset filter → "Just Sent" |
| P2-N07 | `_initialized_keys` never prunes in monitoring.py | Fixed: daily pruning via `_initialized_keys_day` tracking |

No open frontend accuracy items.

---

## SECTION 7 — Production Bug History

Chronological record of platform bugs found and fixed.

### Zero-signal June 15–19 (P0, root cause)
**Bug:** Grade D backstop in `probability.py` used global cohort grade (~20% WR → Grade D) → `should_suppress_send()` returned True for ALL signals.
**Fix (commit `9457738`):** `_regime_grade` from regime-level cohort only; returns `None` when n<30 → no suppress.
**Impact:** Zero WhatsApp alerts June 15–19 despite ~50 signals/day generated.

### Analytical bugs (P0, commit `57e9cea`)
| Bug ID | Field | Error | Fix |
|--------|-------|-------|-----|
| FG-01 | `return_r` typo | Non-existent column → all WR/Exp/PF = 0 | `rr_achieved` |
| FG-02 | TIMEOUT excluded from SL returns | Denominator wrong | Include TIMEOUT in SL count |
| H-02 | `ai_validation` key wrong | Count always 0 | Correct key |
| PC-03 | `sharpe` key wrong | Dashboard error | Correct key |
| PC-04 | `generated_at` key wrong | Cache miss | Correct key |
| H-11 | WR% rendered as float not % | "0.33" not "33%" | `.toFixed(1) + '%'` |

### Second-pass P0 bugs (all fixed June 22)
| Bug ID | Description | Fix commit |
|--------|-------------|------------|
| P0-NEW-01 | `flags.telegram` always false — settings fetched wrong group | `e21b545` |
| P0-NEW-02 | LifecycleFunnel "Generated" capped at 200 | `e21b545` |
| P0-NEW-03 | LifecycleFunnel double-counted TELEGRAM_SENT | `c85c14b` |
| P0-NEW-04 | Tactical route outcome non-deterministic (PENDING not excluded) | `c85c14b` |

### Dashboard truth fixes (FIXES.1–4)
| Commit | Fix |
|--------|-----|
| `9457738` | Zero-signal root cause (Grade D backstop) |
| `57e9cea` | 6 analytical bugs |
| `75d0014` | PLATFORM_STABILIZATION 11 items |
| `e21b545` | P0-NEW-01 + P0-NEW-02 |
| `c85c14b` | P0-NEW-03 + P0-NEW-04 |
| `af443f2` | FIXES.3 (11 items) |
| `243e9bd` | FIXES.4 (4 post-review items) |
| `7ae4f49` | DASHBOARD.TRUTH.FIXES.4 (Track Record canonical, CMC cache age, WrSparkBar scale) |
| `70c7f93` | Worker HEALTHY false-DOWN (SYSTEM.DIAGNOSTICS.1) |
| `498ca4a` | UI.UX.MODERNIZATION.1 (25 visual polish items) |

---

## SECTION 8 — Verified Database Fields

Fields that exist in DB and are correctly mapped in API/frontend (verified June 22):

**`signals` table (key fields):**
`id, symbol, signal_type, mode, confidence, setup_score, market_regime, btc_regime, breakout_strength, oi_interpretation, funding_trend, positioning_context, momentum_score, trend_score, sector_status, validation_source, telegram_sent, telegram_delivered, telegram_delivery_error, empirical_wr, empirical_n, empirical_grade, entry_price, take_profit, stop_loss, risk_reward, created_at, indicators (JSONB)`

**`signal_outcomes` table (key fields):**
`id, signal_id, symbol, signal_type, timeframe, scanner_mode, entry_price, target_price, stop_loss, rr_ratio, confidence, ai_validated, risk_grade, outcome (PENDING/TP_HIT/SL_HIT/TIMEOUT), rr_achieved, pnl_pct, duration_hours, market_regime, resolution_source, resolved_at, created_at`

**`attribution_snapshots` table:**
`id, snapshot_date, dimension, dimension_value, win_rate, expectancy, profit_factor, n, regime, signal_type, breakout_strength, created_at`

**`ai_call_log` table:**
`id, symbol, setup_score, used_fallback, is_approved, latency_ms, tokens_used, error_message, created_at`

---

## SECTION 9 — Platform Quality Scores

| Date | Score | Source |
|------|-------|--------|
| Pre-stabilization (June 16) | ~7.0/10 | Production readiness audit |
| Post-PROD.FIX.1 (June 20) | 9.5/10 | PRODUCTION_READINESS_AUDIT.md |
| Post-PLATFORM_STABILIZATION (June 20) | 9.8/10 | PLATFORM_STABILIZATION_1.md |
| Post-STABILIZATION_CLOSEOUT (June 22) | 8.6/10 (combined) | STABILIZATION_CLOSEOUT_1.md |
| Post-FRONTEND.SYSTEM.TRUTH.FIXES (June 22) | 9.9/10 (dashboard accuracy) | FRONTEND_SYSTEM_TRUTH_FIXES_1.md |
| Current (June 23) | **9.5/10 overall** | Best estimate combining all |

**Remaining blockers from 9.5→10.0:**
- ANTHROPIC_API_KEY unset (P0) — limits future alpha improvement
