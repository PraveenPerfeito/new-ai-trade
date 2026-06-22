# FRONTEND.SYSTEM.TRUTH.1
<!-- Deep number audit — every visible metric traced from DB → API → frontend -->
<!-- Date: 2026-06-22 · Method: 3-agent parallel audit of signals/performance/system pages -->

## Overview

Every visible number in the 3 admin centers audited across 5 dimensions:
database source → API source → frontend calculation → cache layer → polling layer.

**Scope:** `app/admin/signals/page.tsx` · `app/admin/performance/page.tsx` · `app/admin/system/page.tsx`

**Result:** 38 findings — 13 P0 · 20 P1 · 8 P2

| Priority | Count | Meaning |
|----------|-------|---------|
| P0 | 13 | Incorrect number — founder is seeing wrong data |
| P1 | 20 | Inconsistent/misleading — number exists but disagrees with another source or mislabels what it shows |
| P2 | 8 | Cosmetic — display imprecision, stale label, minor confusion |

Cross-reference: items marked **[KNOWN]** appeared in `PRODUCTION_TRUTH_VERIFICATION_1.md`. Items marked **[NEW]** are first documented here.

---

## P0 — Incorrect Numbers

### SIG-P0-01 — Signals/Active/Won/Lost/Expired ALL capped at 200-signal feed [KNOWN: SIGCNT-A2]
**File:** `app/admin/signals/page.tsx:1137, 1693–1700`

Every count derived from the `trading:tactical-feed` shared poll is capped at the 200-signal slice returned by `/api/signals/tactical?limit=200`. This includes:
- OverviewTab mini-grid: Active, Sent, TP Hit, SL Hit
- LifecycleFunnel: Sent, Active, Won, Lost, Expired
- All SignalsTab preset badge counts

**What founder sees:** "Sent: 45" when 90 were sent in the 7d window.

**DB source:** `signals` table, 7d window.  
**API source:** Tactical route fetches `limit*2=400` raw, slices to 200.  
**Fix:** Use `/api/signals/counts` for Sent/Active. Pass `dbTotal` to preset badge computation.

---

### SIG-P0-02 — LifecycleFunnel "Screened: N" includes resolved/expired signals [NEW]
**File:** `app/admin/signals/page.tsx:1691`

```tsx
const scrCount = signals.length - aiCount
```
`scrCount` = every non-Claude signal in the feed, including TP_HIT, SL_HIT, STALE, CLOSED. With 200 loaded signals and AI disabled, "Screened: 200" always. This is not a stage count — it's a population split.

**What founder sees:** "Screened: 178" implying 178 signals awaiting sends when most are resolved.

**Fix:** Count only `s.lifecycleStage === 'SCREENED'` for the Screened chip, not population subtraction.

---

### SIG-P0-03 — Dead polling: `auditEntries` + `healthReady` fetched but never rendered [NEW]
**File:** `app/admin/signals/page.tsx:2220–2221, 2235–2236`

Two `useSharedPolling` registrations produce API calls every 300s and 600s but the returned values are never referenced in the JSX:
```tsx
const { data: auditEntries } = useSharedPolling('trading:audit', auditFetcher, 600_000)
const { data: healthReady }  = useSharedPolling('trading:health-ready', healthFetcher, 300_000)
```
`auditEntries` and `healthReady` are never used. These are 2 unnecessary outbound API calls per session hitting the Python backend settings audit and health check endpoints.

**Fix:** Remove both dead `useSharedPolling` registrations.

---

### PERF-P0-01 — Edge tab "Regime Performance" groups by `volatility_regime`, not BTC market regime [NEW]
**File:** `backend/analytics/edge_validation.py:368`

The Regime Performance table in the Edge tab uses `volatility_regime` (LOW/NORMAL/HIGH/EXTREME) from `signal_outcomes`. This is a legacy Phase-4 concept distinct from BTC market regime (BULL_TREND/BEAR_TREND/etc.) which drives ALPHA.TRUTH.1 gates.

**What founder sees:** Regime Performance grouped by volatility bucket — the primary signal quality driver (BTC regime) is absent from the Edge tab entirely.

**DB source:** `signal_outcomes.volatility_regime`  
**What it should be:** `signals.market_regime` (BULL/BEAR/SIDEWAYS/HIGH_VOLATILITY/EUPHORIA/CAPITULATION)  
**Fix:** Update `edge_validation.py:market_regime_analysis()` to query `signals.market_regime` via JOIN.

---

### PERF-P0-02 — CalibrationHealthPanel grade inversion check uses A+/B+ grades that never exist in attribution data [NEW]
**File:** `app/admin/performance/page.tsx:942`

```tsx
const gradeOrder = ['A+', 'A', 'B+', 'B', 'C', 'D']
```
`AttributionRow.riskGrade` is typed `'A' | 'B' | 'C' | 'D' | 'F'` — the heuristic system only uses A/B/C/D/F. `A+` and `B+` entries in `gradeOrder` never match any `byGrade` row. Inversion checks across the A+→A and B+→B boundaries are silently skipped. The health score (`100 - inversions * 20`) appears clean even when the full monotonicity chain wasn't verified.

**Fix:** Either use empirical grades (A+/A/B+/B/C/D) via `empiricalGrade` column or limit the grade order to `['A','B','C','D','F']`.

---

### PERF-P0-03 — `EdgeReport.generated_at` typed non-optional but Python never sends it [KNOWN: PC-04]
**File:** `lib/admin-api.ts:275`

Python's `generate_edge_validation_report()` returns `report_date`, not `generated_at`. The TypeScript interface declares `generated_at: string` as if always present. Every code path that reads `edge.generated_at` gets `undefined` — the UI works around it via `edge.report_date ?? edge.generated_at` in some places but not all.

**Status:** Display bug; partially worked around at `performance/page.tsx:480` but the type contract misleads future callers.

---

### SYS-P0-01 — `not_configured` service treated as "All Systems OK" — hides unconfigured PostgreSQL [NEW]
**File:** `app/admin/system/page.tsx:113, 2132`

```tsx
const isOk = ['ok', 'ready', 'not_configured', 'HEALTHY'].includes(status)
// ...
checksOk = Object.values(checks).every(st => ['ok','ready','not_configured','HEALTHY'].includes(st))
```
When PostgreSQL returns `not_configured` (missing `DATABASE_URL`), `checksOk=true`, `allHealthy=true`. The page collapses to the compact inline chip view showing all-green with no mention of the unconfigured service. A completely absent database is invisible to the founder.

**Fix:** Remove `not_configured` from the OK-list check for `allHealthy`/compact view. Keep it for the ServiceCard dot (to avoid red pulse for optional providers) but treat it as non-OK for the "all systems operational" determination.

---

### SYS-P0-02 — `telegram_sends_per_day` is UTC-day counter; `signals_per_day` is rolling 24h — they're shown side-by-side [KNOWN: REDIS-G1, P2-N09-adjacent]
**File:** `backend/analytics/monitoring.py:223`

```python
tg_sends = await _read("telegram_sends")  # reads monitor:{today}:telegram_sends
# ...
sig_count = await _read_db_generated_signals_24h(...)  # rolling 24h from DB
```
The two metrics appear in the same "Signals & Outcomes" section of the Monitor card. At UTC midnight, `telegram_sends_per_day` resets to 0 while `signals_per_day` continues to count signals from the prior hour. For 1 hour around midnight the ratio `sends/signals` appears near 0 with no alert.

**Fix:** Add DB fallback: `SELECT COUNT(*) FROM signals WHERE telegram_sent = true AND created_at > NOW() - INTERVAL '24 hours'` — mirrors the existing `_read_db_generated_signals_24h` pattern.

---

### SYS-P0-03 — PipelineIntegrityCard "WhatsApp Delivery %" uses wrong denominator [NEW]
**File:** `app/admin/system/page.tsx:202`

```tsx
const telegramPct = signals24h > 0 ? Math.round(telegrams24h / signals24h * 100) : null
```
- `signals24h` = rolling 24h **all generated signals** from DB (includes signals that never reached the alert threshold)
- `telegrams24h` = UTC-day Redis counter of sends

This produces "WhatsApp Delivery: 18%" when 18 of 100 generated signals were sent — which is correct pipeline throughput but is labeled "delivery" implying delivery reliability. Real delivery reliability (`delivered / queued`) already exists in `TelegramDeliveryCard` at line 336.

**Fix:** Label as "Send Rate (of generated)" and show the real delivery rate from `adminApi.analytics.telegramDelivery()`.

---

### SYS-P0-04 — `scans_today` monitoring metric level hardcoded "healthy" — never warns on zero-scan day [NEW]
**File:** `backend/analytics/monitoring.py:306`

```python
"scans_today": {"value": scans, "unit": "scans", "level": "healthy"}
```
Level is hardcoded regardless of `scans` value. A complete scanner outage (0 scans) shows green in the Monitor section. The anomaly detector handles `zero_signals` but not `zero_scans` — a scanner that runs but finds 0 signals would still show green here.

**Fix:** Add `scans_today` to `THRESHOLDS`: warn if <8/day (target ~96/day across 4 modes × 24 runs), critical if <2/day.

---

### SYS-P0-05 — Anomalies tab "Monitored Checks" list doesn't match backend's actual anomaly types [NEW]
**File:** `app/admin/system/page.tsx:818–835`

UI lists: `win_rate_degradation, expectancy_negative, false_positive_spike, drawdown_spike, calibration_drift, scan_failure_spike, ai_error_spike, queue_backlog`

Backend actually generates (`monitoring.py:355–398`): `zero_signals, claude_fallback_spike, binance_error_spike, slow_scan`

There is zero overlap between the 8 types shown in the UI and the 4 types the backend produces. The "Monitored Checks" section always shows a static list that has never been accurate.

**Fix:** Remove the static list. Replace with a dynamic list from `adminApi.burnin.anomalies()` showing what was actually detected + when each check last ran.

---

### SYS-P0-06 — Claude and WhatsApp provider health latency both show Railway-roundtrip (same value) [KNOWN: HEALTH.WA.1 adjacent]
**File:** `app/api/health/providers/route.ts:108–130`

One `fetch` call is made to Railway `/health/ready`. Both `claude.latencyMs` and `whatsapp.latencyMs` are set to the same `Date.now() - t0` value. The ProviderHealthTable shows "Claude: 320ms · WhatsApp: 320ms" implying two separate provider checks were done. Neither represents Anthropic API latency or UltraMsg API latency — both show the Vercel→Railway RTT.

**Fix:** Set `note: 'latency = Railway RTT, not provider latency'` on both entries, or make the label "Check Latency" instead of showing it as a health indicator.

---

### SYS-P0-07 — SystemStatusBanner shows "flags.telegram" always false when `features.telegram` key is absent [KNOWN: P0-NEW-01]
**File:** `app/admin/signals/page.tsx:2208–2218`

`flagsFetcher` fetches only the `features` group and reads `field(featRes, 'telegram')`. The `features` group's `telegram` field IS present (verified in FLAG_META). But the `flagsFetcher` in `signals/page.tsx` may differ from the one in `system/page.tsx`. 

**Status verification needed:** Confirm if `app/admin/signals/page.tsx:flagsFetcher` fetches `features.telegram` correctly after P0-NEW-01 fix. If the fix only landed in `system/page.tsx` but not `signals/page.tsx`, the SystemStatusBanner on the signals page still shows "TELEGRAM OFF" permanently.

---

## P1 — Inconsistent / Misleading Numbers

### SIG-P1-01 — OverviewTab mini-grid "Active" counts 4 lifecycle stages via `isActiveStage()` [KNOWN: PCT-07]
**File:** `app/admin/signals/page.tsx:1136`
`isActiveStage()` = ACTIVE + AI_APPROVED + SCREENED + TELEGRAM_SENT. Label says "Active" implying only live-within-window signals.

### SIG-P1-02 — LifecycleFunnel header says "last N signals" using capped `signals.length` not `dbTotal` [NEW]
**File:** `app/admin/signals/page.tsx:1724`
Header: `Pipeline · last {signals.length} signals` always ≤200. Should be `Pipeline · last {dbTotal ?? signals.length} signals`.

### SIG-P1-03 — LifecycleFunnel `aiCount` uses fragile OR-condition [KNOWN: SIGCNT-A5]
**File:** `app/admin/signals/page.tsx:1690`
```tsx
signals.filter(s => s.validationSource === 'CLAUDE' || s.lifecycleStage === 'AI_APPROVED')
```
The `lifecycleStage === 'AI_APPROVED'` branch never fires for post-send Claude signals (their stage advances to TELEGRAM_SENT/ACTIVE). The OR adds no extra matches for correctly-stamped signals but creates ambiguity for edge cases.

### SIG-P1-04 — `gradeAPct` in SignalQualityScorecard excludes A+ from "Grade A" count [NEW]
**File:** `app/admin/signals/page.tsx:1047–1048`
```tsx
withGrade.filter(s => s.riskGrade === 'A').length
```
Strict equality excludes `A+`. "Grade A %" understates the top-tier cohort.

### SIG-P1-05 — `gradeAPct` mixes signal-feed source with outcome-based scorecard metrics [NEW]
**File:** `app/admin/signals/page.tsx:1046–1049`
Scorecard WR/Exp/PF come from `/api/signals/counts` (DB, outcome-based). `gradeAPct` is computed from the 200-signal tactical feed (pre-outcome state). Mixed data sources on same scorecard.

### SIG-P1-06 — Grade filter uses `empiricalGrade ?? riskGrade`; sort uses only `riskGrade` [KNOWN: H-10]
**File:** `app/admin/signals/page.tsx:1295, 1307`
A user filtering by grade "A" may match signals whose `empiricalGrade=A, riskGrade=B`. These then sort as B. The badge displayed in each row shows `riskGrade`, not `empiricalGrade`, so the user sees grade-B badge in their grade-A filtered list.

### SIG-P1-07 — Pagination "K in DB" shows unfiltered DB total regardless of active client-side filters [KNOWN: SIGCNT-A4]
**File:** `app/admin/signals/page.tsx:1493–1494`
With mode=futures filter: "5 of 8 shown · 347 in DB" — the 347 is all signals, not 347 futures signals.

### SIG-P1-08 — RegimeTab "Allowed signals" is `avg × count` estimate, not actual count [NEW]
**File:** `app/admin/signals/page.tsx:2033`
```tsx
totalAllowed = Math.round((scanStats.avg_signals_found ?? 0) * (scanStats.total_scans ?? 0))
```
Mean × count ≠ sum with variance. Also `avg_signals_found` is post-ALL-gates output, not specifically regime-gate output.

### SIG-P1-09 — SystemStatusBanner shows "All Systems Operational" when `last_scan_at === null` [NEW]
**File:** `app/admin/signals/page.tsx:997–1004`
On first startup before any scan has run, `is_overdue=false`, `scanning=false`, `enabled=true` — banner shows all-clear despite zero scans ever having occurred.

### SIG-P1-10 — AlphaWatchlist `confidence >= 75` threshold doesn't reflect per-mode alert thresholds [NEW]
**File:** `app/api/signals/watchlist/route.ts:38` (inferred)
Hardcoded `confidence >= 75` regardless of mode. A 76% futures signal (alert threshold 87) is not a "near-miss" — it's correctly blocked. The watchlist shows it as a near-miss.

### SIG-P1-11 — OverviewTab BUY/SELL balance chips count 200 signals but only 6 are displayed [NEW]
**File:** `app/admin/signals/page.tsx:1198–1199`
Balance chips: counts from full `signals` prop (200 items). Display: `signals.slice(0,6)`. "150 BUY / 50 SELL" next to a list of 6 signals is confusing.

### SIG-P1-12 — RegimeTab WR multiplied by 100 — unverified if endpoint returns 0–1 or 0–100 [NEW]
**File:** `app/admin/signals/page.tsx:2074`
```tsx
Math.round(currentPerfRow.win_rate * 100)%
```
If the regime analytics endpoint returns win_rate as 0–100, this displays "3500%". Type contract on `win_rate` is `number | null` with no scale annotation. Compare: Edge tab uses `Number(overall.win_rate) * 100` (correct for 0–1 scale); Track Record uses `toNum(w.win_rate)` directly (correct for 0–100 scale).

### PERF-P1-01 — Track Record win_rate is 0–100 scale; Edge win_rate is 0–1 — undocumented [NEW]
**File:** `backend/api/analytics.py:169` vs `backend/analytics/edge_validation.py`
Python `_window()` returns `win_rate = round(wins/total * 100, 2)` (0–100). Python `group_stats()` returns `round(wr, 4)` (0–1). Both are used in the same `adminApi` client. A developer reusing the wrong type in a new consumer would display 100× inflated win rates.

### PERF-P1-02 — Attribution TypeScript expectancy uses flat −1R loss; Python uses actual `rr_achieved` [NEW]
**File:** `lib/outcome-attribution.ts:43`
```ts
expectancy: winRate * avgWinRR - lossRate * 1
```
Python's `group_stats`: `safe_mean(rr_values)` over actual `rr_achieved` values. For structure-aware stops (SIGNAL.QUALITY.1), SL hits may be −0.7R or −1.3R. Attribution expectancy and Edge expectancy diverge for the same signal cohort.

### PERF-P1-03 — RiskGradeAnalysis footer says "futures penalty +5→+2" — ALPHA.TRUTH.1 set it to 0.0 [NEW]
**File:** `app/admin/performance/page.tsx:722`
Stale text from RISKGRADE.FIX.1. Per CLAUDE.md #41 and commit `11a3133`, penalty = `0.0`. The footer displays factually incorrect information about current live grading behavior.

### PERF-P1-04 — "not post-deploy" qualifier in window labels misleading on mature system [NEW]
**File:** `lib/window-label.ts:12–13`
`explicitWindowNote(720)` returns "Historical 30d window, not post-deploy" appearing in Edge verdict warmup message, intelligence footer, and edge report footer. On a platform running for weeks, every analytics footer reads as though the data is from before the current deployment. Should either be removed or rephrased.

### SYS-P1-01 — CMC cache age hardcodes 300s TTL assumption — shows "0m old" for any key with TTL > 300s [NEW]
**File:** `app/api/health/providers/route.ts:85`
```tsx
const ageSeconds = 300 - ttl
```
If actual TTL is 400s (worker set it higher), `ageSeconds = -100` → clamped to 0 → age shows "0m old" even though key may be 5 minutes old.

### SYS-P1-02 — Celery heartbeat age computed differently in TypeScript (TTL-based) vs Python (timestamp-based) — up to 600s divergence [NEW]
**File:** `app/api/health/providers/route.ts:203` vs `backend/api/health.py:69–76`
TypeScript: `ageSeconds = Math.max(0, 1800 - ttl)`. Python: `age = time.time() - float(worker_ts)`. The two age values can diverge by up to the full 600s beat interval depending on when within the cycle the check runs.

### SYS-P1-03 — System Status Grid shows WhatsApp ACTIVE even if `features.telegram` master switch is OFF [NEW]
**File:** `app/admin/system/page.tsx:291, 486`
Status grid reads `telegram.alerts_enabled` for WhatsApp status. `features.telegram` is the master switch checked by the backend. A user could see "WhatsApp: ACTIVE" in the status grid while `features.telegram=false` silences all output. The SafetyStatusCard covers this via red warning list, but the main status chip is misleading.

### SYS-P1-04 — Scan duration Redis fallback reads a key that is never written [NEW]
**File:** `backend/analytics/monitoring.py:218`
`record_scan()` is a no-op stub. The fallback reads `monitor:last_scan_duration_ms` which is never written. When Redis is the data source (DB unavailable), last scan duration always shows 0s.

### SYS-P1-05 — PipelineIntegrityCard checks 12 keys; GateRejectionGrid shows 15 — no explanation for the gap [NEW]
**File:** `app/admin/system/page.tsx:164–168, 246–262`
`PIPELINE_CANON_KEYS`: 12 entries. `GATE_REJECTION_LABELS`: 15 entries (adds KLINE_EMPTY, KLINE_PARTIAL, CONTRA_REGIME_REJECTION). The card "N/12" and the grid below it refer to different gate sets. A founder checking "Gate Accounting: 11/12" and then seeing KLINE_EMPTY counts in the grid below doesn't know whether KLINE_EMPTY is one of the 12 or not.

### SYS-P1-06 — Anomaly state (ACK/MUTED/RESOLVED) is localStorage-only [KNOWN: Phase 7.2B.4 design]
**File:** `app/admin/system/page.tsx:623`
Lost on new browser, incognito, or cache clear. Every anomaly reappears as NEW. Backend has no state for user-acknowledged anomalies.

---

## P2 — Cosmetic / Minor

### SIG-P2-01 — RegimeHardGateCard "Est. Avoided Loss" presents estimated portfolio R without caveat [NEW]
**File:** `app/admin/signals/page.tsx:1952`
`avoided7d = count7d × 0.405R` displayed as `+{avoided7d.toFixed(1)}R` with no "estimate" qualifier.

### SIG-P2-02 — OverviewTab win_rate from FounderCommandCenter displayed without rounding [NEW]
**File:** `app/admin/signals/page.tsx:372`
`{wr}%` may render as "35.40000001%" if Python returns an unrounded float.

### PERF-P2-01 — Track Record window cards omit TIMEOUT count in Wins/Losses footer [NEW]
**File:** `app/admin/performance/page.tsx:1148`
Footer shows "48W · 40L" but resolved = 120 (32 TOIMEOUTs invisible). Diverges from Edge tab which shows `TP: N · SL: N · TO: N`.

### PERF-P2-02 — Coin Performance table requests 10 rows; Python only sends top 5 [NEW]
**File:** `app/admin/performance/page.tsx:429`
`.slice(0, 10)` but `best_by_expectancy[:5]` from Python. Table always shows ≤5 rows despite implying top 10.

### PERF-P2-03 — CalibrationHealth score skips A+/B+ grade pairs — artificially inflated score [NEW]
**File:** `app/admin/performance/page.tsx:970`
A+/B+ never match attribution rows → 2 of 5 adjacent-grade transitions silently unchecked → `100 - inversions × 20` score looks clean even when full chain wasn't verified.

### SYS-P2-01 — Provider health 300s module-level cache is per-Vercel-instance — `cached: true` is per-instance only [NEW]
**File:** `app/api/health/providers/route.ts:12`
Two Vercel instances serving the same user within 5 min can return cached: true from different timestamps.

### SYS-P2-02 — "Scans Today" in accordion vs "Total Scans" in Health main tab are same rolling-24h metric with different labels [NEW]
**File:** `app/admin/system/page.tsx:411, 2185`
Both query rolling-24h scans from `scan_metrics_log`. Different labels for same data.

### SYS-P2-03 — ServiceCard dot-color and border/text use conflicting style branches for `not_configured` [KNOWN: SYS-02 above]
**File:** `app/admin/system/page.tsx:115–117`
Dot = dark grey (`isConfigured=false`). Border/text = healthy-zinc (`isOk=true`). Visual inconsistency but not a number-accuracy issue.

---

## Full Count Audit — Numbers vs Source

### Signals Center

| Display | Source | DB Query | Cache/Poll | Accurate? |
|---------|--------|----------|-----------|-----------|
| `signals_today` (Overview tile) | `/api/signals/counts` | `signals WHERE created_at >= now-24h` COUNT | 120s shared poll | ✅ Rolling 24h, DB-authoritative |
| `active_signals` (Overview tile) | `/api/signals/counts` | Two-step: 7d IDs → resolved IDs → subtract | 120s shared poll | ✅ Correct (PostgREST fix #40 applied) |
| `win_rate_7d` (Overview tile) | `/api/signals/counts` | `rr_achieved` from `signal_outcomes`, TP+SL+TIMEOUT | 120s shared poll | ✅ Includes TIMEOUT (FG-02 fix applied) |
| `expectancy_7d` (Overview tile) | `/api/signals/counts` | `avg(rr_achieved)` over outcomes with value | 120s shared poll | ⚠️ P1 — `avg(rr_achieved)` not canonical Exp formula |
| OverviewTab "Active" mini-stat | Signal feed, `isActiveStage()` | Feed capped at 200 | 120s shared poll | ⚠️ P1 — counts 4 stages, label implies 1 |
| OverviewTab "Sent" mini-stat | Signal feed, `telegramSent` | Feed capped at 200 | 120s shared poll | ⚠️ P0 — capped at 200 |
| OverviewTab "TP Hit" | Signal feed, lifecycle counts | Feed capped at 200 | 120s shared poll | ⚠️ P0 — capped at 200 |
| OverviewTab "SL Hit" | Signal feed, lifecycle counts | Feed capped at 200 | 120s shared poll | ⚠️ P0 — capped at 200 |
| Track Record WR% | `/api/analytics/track-record` → Python | `signal_outcomes` by window | 300s auto-refresh | ⚠️ P1 — excludes TIMEOUT (PC-01 open) |
| Track Record Expectancy | `/api/analytics/track-record` → Python | `avg(rr_achieved)` | 300s auto-refresh | ⚠️ P1 — not canonical formula (PC-02 open) |
| LifecycleFunnel "Generated" | Tactical route `dbTotal` | `signals` 7d COUNT | 120s shared poll | ✅ DB-authoritative |
| LifecycleFunnel "Sent" | Signal feed, `telegramSent` | Feed capped at 200 | 120s shared poll | ⚠️ P0 — capped at 200 |
| LifecycleFunnel "Active" | Signal feed, ACTIVE stage | Feed capped at 200 | 120s shared poll | ⚠️ P0 — capped at 200 |
| LifecycleFunnel "Screened: N" | `signals.length - aiCount` | — (population split) | 120s shared poll | ❌ P0 — includes resolved signals |
| LifecycleFunnel "Won" | Signal feed, TP_HIT stage | Feed capped at 200 | 120s shared poll | ⚠️ P0 — capped at 200 |
| LifecycleFunnel "Lost" | Signal feed, SL_HIT stage | Feed capped at 200 | 120s shared poll | ⚠️ P0 — capped at 200 |
| Preset badge counts (Active/Won/Lost/Expired) | `nonPresetFiltered` | Feed capped at 200 | 120s shared poll | ⚠️ P0 — still capped at 200 (SIGCNT-A2 fixed preset→nonPreset but cap remains) |
| Grade A% in Scorecard | Signal feed | `signals` with riskGrade populated | 120s shared poll | ⚠️ P1 — excludes A+; mixes sources with outcome metrics |
| Confidence bar (filtered) | Signal feed post-filters | — | 120s shared poll | ✅ Correctly labelled "(filtered)" |
| Pagination "K in DB" | Tactical route `dbTotal` | `signals` 7d, no type/mode filter | 120s shared poll | ⚠️ P1 — unfiltered count with active client filters |
| Regime WR% in RegimeTab | Regime analytics endpoint | `signal_outcomes` + `signals` JOIN | 300s useEffect | ⚠️ P1 — ×100 multiply unverified |
| BTC RSI 4h / Trend 4h | BTC regime endpoint | BTC klines, computed | 120s shared poll | ✅ Passes through correctly |

### Performance Center

| Display | Source | DB Query | Cache/Poll | Accurate? |
|---------|--------|----------|-----------|-----------|
| Track Record 7d/30d/90d WR | `/api/analytics/track-record` | `signal_outcomes` by window | 300s useEffect | ⚠️ P1 — TIMEOUT excluded (PC-01); 0–100 scale |
| Track Record 7d/30d/90d Exp | Python `avg(rr_achieved)` | over outcomes with value | 300s useEffect | ⚠️ P1 — not canonical Exp (PC-02) |
| Track Record Profit Factor | Python `gross_profit / abs(gross_loss)` | over outcomes | 300s useEffect | ✅ Correct formula |
| Track Record Sharpe | Python `sharpe_ratio` field | — | 300s useEffect | ✅ Fixed (PC-03) |
| Track Record by-mode WR | Same Python function by mode | TIMEOUT excluded | 300s useEffect | ⚠️ P1 — same PC-01 issue |
| Edge Overall WR | `group_stats()` → 0–1 scale | TP+SL+TIMEOUT | 300s useEffect | ✅ Includes TIMEOUT; displayed ×100 ✅ |
| Edge Overall Expectancy | Python `safe_mean(rr_values)` | all outcomes | 300s useEffect | ✅ Correct canonical formula |
| Edge Profit Factor | `gross_profit / abs(gross_loss)` | — | 300s useEffect | ✅ |
| Edge Confidence Cal bands WR | `band_stats()` → 0–100 | resolved per band | 300s useEffect | ✅ |
| Edge Regime Performance | `volatility_regime` grouping | `signal_outcomes.volatility_regime` | 300s useEffect | ❌ P0 — wrong regime concept |
| Attribution WR % | TypeScript `groupStats()` | Signal feed + outcome map | 300s useEffect | ⚠️ P1 — 0–1 scale but `WrSparkBar` expects 0–100 (DASH-E3) |
| Attribution Expectancy | TypeScript `winRate * avgWinRR - lossRate * 1` | Signal feed + outcome map | 300s useEffect | ⚠️ P1 — assumes −1R loss; Python uses actual rr_achieved |
| Calibration Health Grade Monotonicity | Local computation from byGrade rows | — | 300s useEffect | ❌ P0 — A+/B+ grades never exist; transitions silently skipped |

### System Center

| Display | Source | DB Query | Cache/Poll | Accurate? |
|---------|--------|----------|-----------|-----------|
| Service grid (Redis/PG/Celery/Binance) | `/health/ready` → Railway Python | Live checks each | 300s auto-refresh | ⚠️ P0 — `not_configured` treated as OK |
| Claude health "configured" | `/health/ready` checks.anthropic | Python env check | 300s auto-refresh | ✅ Correct (HEALTH.WA.1 fix) |
| WhatsApp health "configured" | `/health/ready` checks.whatsapp | Python env check | 300s auto-refresh | ✅ |
| Claude latency / WhatsApp latency | Railway RTT | — | 300s auto-refresh | ⚠️ P0 — same value; not provider latency |
| CMC cache age | Redis TTL of listing key | `300 - ttl` | 300s auto-refresh | ⚠️ P1 — wrong if TTL ≠ 300 |
| CloudAMQP heartbeat age | Redis TTL | `1800 - ttl` | 300s auto-refresh | ⚠️ P1 — diverges from Python timestamp method |
| `signals_per_day` (Monitor) | DB rolling 24h | `signals WHERE created_at > now-24h` | 300s auto-refresh | ✅ DB-authoritative |
| `telegram_sends_per_day` (Monitor) | Redis UTC-day counter | — | 300s auto-refresh | ⚠️ P0 — resets at UTC midnight, not rolling 24h |
| `win_rate_7d` (Monitor) | DB rolling 7d | `signal_outcomes` TP+SL+TIMEOUT | 300s auto-refresh | ✅ |
| `scans_today` (Monitor) | DB rolling 24h | `scan_metrics_log` | 300s auto-refresh | ⚠️ P0 — level always "healthy" |
| `last_scan_duration_ms` (Monitor) | DB first, Redis fallback | `scan_metrics_log ORDER BY DESC LIMIT 1` | 300s auto-refresh | ⚠️ P1 — fallback key never written |
| WhatsApp Delivery % (Pipeline Integrity) | `telegrams24h / signals24h` | Mixed sources | 300s auto-refresh | ❌ P0 — wrong denominator, wrong window |
| Gate Accounting N/12 | Scan stats gate_rejections | `scan_metrics_log` 24h SUM | 300s auto-refresh | ⚠️ P1 — 12 vs 15 inconsistency with grid below |
| Gate Rejection Grid counts | `adminApi.analytics.scans(24)` | `scan_metrics_log` 24h aggregate | 300s auto-refresh | ✅ |
| Anomaly count / types | `/api/analytics/anomalies` | Burnin + monitoring | 120s shared poll | ❌ P0 — monitored-checks list wrong |
| Feature flag states | `adminApi.settings.group('features')` | `settings_groups` | 300s auto-refresh | ✅ |
| WhatsApp status chip in Health grid | `flags.telegram` | `telegram.alerts_enabled` | 300s auto-refresh | ⚠️ P1 — ignores `features.telegram` master switch |

---

## Priority Fix Order

### P0 — Fix before next founder review

| ID | Fix | Effort |
|----|-----|--------|
| SYS-P0-01 | Remove `not_configured` from `allHealthy` compact-view check | 5 min |
| SIG-P0-03 | Remove dead `auditEntries` + `healthReady` polling registrations | 5 min |
| SIG-P0-02 | Fix Screened chip: count `lifecycleStage === 'SCREENED'` not population subtract | 5 min |
| SYS-P0-04 | Add `scans_today` threshold: warn <8, critical <2 | 10 min |
| SYS-P0-03 | PipelineIntegrityCard: relabel "WhatsApp Delivery %" → "Send Rate (of generated)" | 5 min |
| SYS-P0-07 | Verify P0-NEW-01 fix (flags.telegram) landed in `signals/page.tsx`, not only `system/page.tsx` | 5 min |
| SYS-P0-06 | Add note to Claude/WhatsApp latency: "latency = Railway RTT, not provider latency" | 5 min |
| SYS-P0-02 | `telegram_sends_per_day`: add DB fallback for rolling 24h count | 45 min |
| PERF-P0-01 | Fix `edge_validation.py:market_regime_analysis()` to use `signals.market_regime` | 30 min |
| PERF-P0-02 | Fix `gradeOrder` in CalibrationHealthPanel: `['A','B','C','D','F']` only | 5 min |
| SYS-P0-05 | Replace static Monitored Checks list with dynamic from actual backend types | 15 min |
| SYS-P0-03 | Link TelegramDeliveryCard delivery rate into PipelineIntegrityCard | 20 min |

### P1 — Fix by Day 14 (2026-06-30)

| ID | Fix | Effort |
|----|-----|--------|
| SIG-P1-04 | Fix `gradeAPct` to include A+: `gradeRank(s.riskGrade) <= 1` | 5 min |
| PERF-P1-03 | Update RiskGradeAnalysis footer: "futures penalty removed (0.0, ALPHA.TRUTH.1)" | 5 min |
| SIG-P1-12 | Verify RegimeTab win_rate scale; add `toFixed(1)%` with correct divisor | 15 min |
| SIG-P1-09 | SystemStatusBanner: add "No scans recorded yet" warning when `last_scan_at === null` | 10 min |
| PERF-P1-02 | Attribution TypeScript expectancy: use `lossRate * Math.abs(avgLossRR)` instead of `* 1` | 15 min |
| SYS-P1-01 | CMC cache age: use `CACHE_GROUP_TTL - ttl` with the actual configured TTL | 10 min |
| SYS-P1-03 | System Status Grid: check both `telegram.alerts_enabled` AND `features.telegram` | 10 min |
| PC-01/PC-02 | Track Record: include TIMEOUT in denominator; use canonical Exp formula | 60 min (Python) |
| SIG-P1-06 | Grade filter + sort: use same source (decide: empirical or risk) | 20 min |
| PERF-P1-04 | Remove/update "not post-deploy" from window label notes | 5 min |

### P2 — Fix by Day 30 (2026-07-16)

| ID | Fix | Effort |
|----|-----|--------|
| SIG-P2-02 | `win_rate` in FounderCommandCenter: add `?.toFixed(1)` | 2 min |
| PERF-P2-01 | Track Record footer: add TO count alongside Wins/Losses | 10 min |
| PERF-P2-02 | Coin Performance: Python `best_by_expectancy[:10]` (currently `:5`) | 5 min |
| PERF-P2-03 | CalibrationHealth: only check grades that exist in `byGrade` data | 10 min |
| SYS-P2-02 | Harmonize "Scans Today" vs "Total Scans" labels | 5 min |
| SYS-P1-05 | Clarify PipelineIntegrityCard/GateRejectionGrid key count discrepancy | 10 min |

---

## Already Fixed (cross-reference)

These were found in `PRODUCTION_TRUTH_VERIFICATION_1.md` and confirmed fixed in current code:

| ID | Fix |
|----|-----|
| PCT-01 (active_signals) | Two-step PostgREST query — PostgREST subquery fix #40 |
| PCT-02 (Funnel Sent double-count) | `telegramSent` bool only — fixed SIGNAL.QUALITY.3 |
| FG-01 (`return_r` typo) | Fixed `57e9cea` |
| FG-02 (TIMEOUT excluded from WR) | Fixed `57e9cea` |
| H-02 (ai_validation key) | Fixed `57e9cea` |
| PC-03 (sharpe key) | Fixed `57e9cea` |
| PC-04 (generated_at key) | Fixed `57e9cea` (workaround only — type still wrong, see PERF-P0-03) |
| SIGCNT-A2 (preset badge from unfiltered) | Fixed — `nonPresetFiltered` introduced |
| DASH-E1 (scheduler type) | Fixed — type extended |
| P0-NEW-04 (tactical outcome no `.neq(PENDING)`) | Fixed |
| Worker health `=== 'ok'` | Fixed `70c7f93` |
| OverviewTab "Sent" lifecycle inference | Fixed (this session, `page.tsx:1137`) |

---

*Audit date: 2026-06-22 · 3-agent parallel investigation · 38 findings (13 P0 · 20 P1 · 8 P2)*  
*Goal: Founder can trust every number on every screen.*  
*Next step: Apply P0 fixes in priority order above.*
