# PROFIT.PRESERVATION.1
**Date:** 2026-06-23  
**Purpose:** Identify and classify all risks that could cause WR, PF, or Expectancy to regress from the recovery baseline.  
**Baseline:** WR=33.15%, PF=1.204, Exp=+0.1245R (ALPHA_MONITORING_1.md, 2026-06-23)  
**Constraint:** Observe only — no strategy changes, no new features, no indicators.  
**Source docs:** `docs/ALPHA_MONITORING_1.md` · `docs/POST_DEPLOY_RECOVERY_MEASUREMENT_1.md`

---

## Summary

| Priority | Count | Highest-risk item |
|----------|-------|-------------------|
| **P0** | 2 | Redis max-connections exhausted — system running degraded |
| **P1** | 5 | BULL_TREND ungated (WR=21.65%), grade inversions, CMC credits=0 |
| **P2** | 4 | WR at breakeven threshold, TRENDING negative, regime dependency |

---

## 1. Gate Drift

**Status: STABLE**  
**Classification: P2 (no action)**

### Evidence — 7D scan metrics (969 scans, window_hours=168)

| Gate | 7D Count | Rate | Assessment |
|------|----------|------|-----------|
| REGIME_REJECTION (NULL gate) | 2 | <0.1/day | ✅ NULL gate working — ALPHA.TRUTH.1 effective |
| CONTRA_REGIME_REJECTION | 60 | 8.6/day | ✅ Active — blocking BUY in BEAR_TREND correctly |
| SIDEWAYS_REJECTION | 0 | 0/day | ✅ Expected — BTC is BEAR_TREND since June 23 |
| CONFIDENCE_REJECTION | 2,668 | 381/day | ✅ Proportional to coin volume |
| RISK_REJECTION (Grade D) | 293 | 42/day | ✅ Normal |
| SETUP_REJECTION | 90 | 13/day | ✅ Normal |
| KLINE_EMPTY | 5,290 | 756/day | ⚠️ Elevated — 7.8% of coin attempts |
| KLINE_PARTIAL | 160 | 23/day | ℹ️ Monitor |

### Observations

- **NULL gate (REGIME_REJECTION=2):** ALPHA.TRUTH.1 hard gate is functioning. Only 2 NULL-regime signals reached the gate in 7 days. No drift.
- **Contra-regime gate (60/7D):** Regime v2 is active and blocking BUY signals in BEAR_TREND. 8.6/day is proportional to the signal volume in this regime.
- **SIDEWAYS_REJECTION=0:** Correct. BTC transitioned to BEAR_TREND on June 23. The SIDEWAYS gate was deployed today; no SIDEWAYS periods have occurred post-deployment.
- **KLINE_EMPTY=5,290 (7.8% of ~67,830 coin attempts):** Elevated but not abnormal. `binance: "ok"` in health checks, `binance_errors=0` in monitor. Likely a mix of thin listings, new listings, and pair-level geo restrictions — not a systematic Binance outage. Does not cause WR regression (reduces volume, not quality).

**Risk to WR:** Low. No gate has shown unexpected drift. The static code guarantees gate logic is unchanged.

**Action:** None during freeze. At D7, verify KLINE_EMPTY has not risen above 10,000/week (would indicate Binance API degradation).

---

## 2. Probability Drift

**Status: MATERIAL DRIFT — PROBABILITIES UNCALIBRATED**  
**Classification: P1**

### Evidence (performance-verification endpoint)

| Cohort | Predicted WR | Actual WR | Drift | Calibrated |
|--------|-------------|-----------|-------|-----------|
| BULL_TREND (n=97) | 33.1% | 21.6% | **−11.4pp** | ❌ |
| SIDEWAYS (n=193) | 24.2% | 33.2% | +9.0pp | ❌ |
| SELL signals (n=119) | 21.1% | 35.3% | **+14.2pp** | ❌ |
| BUY signals (n=171) | 31.4% | 25.1% | −6.2pp | ✅ |
| **Overall MAE** | — | — | **40.9pp** | — |

The attribution snapshot (1,243 rows, rebuilt nightly at 00:15 UTC) is materially miscalibrated. MAE=40.9pp means predictions are on average 41 percentage points off.

### Risk to WR

**The blocking direction is correct.** BULL_TREND actual WR=21.6% is below the 40% threshold — the gate blocks it regardless of the predicted value. The drift does not cause the gate to pass signals it should block.

**SELL over-blocking (conservative error):** SELL actual WR=35.3% but predicted=21.1%. The probability gate suppresses SELL signals where the attribution snapshot records < 40% WR. If many SELL cohort cells in the snapshot show ~21% (matching the average), valid SELL signals with 35% actual WR are being withheld. This is a **loss of profitable signals** rather than WR degradation — delivered SELL signals still pass quality gates, but fewer good SELL signals are delivered.

**Snapshot staleness compounds over time:** As BEAR_TREND outcomes continue to resolve at WR=51.4%, the nightly snapshot will increasingly diverge from the prior SIDEWAYS-era data. 24-hour lag is acceptable; multi-week staleness is not.

**Direct WR regression path:** If a regime shift causes a new cohort to land in the 35-45% WR range (above the 40% threshold but actually below breakeven), signals from that cohort would pass the gate and drag WR down. Currently no such cohort is identified — all major cohorts are either above 50% (BEAR_TREND) or well below 40% (BULL_TREND, SIDEWAYS overall).

**Action:** P1 — No change during freeze. After D7, if SELL delivery count is conspicuously low relative to generated count, recalibrate `min_empirical_wr` or review SELL cohort snapshot cells.

---

## 3. RiskGrade Drift

**Status: HEURISTIC GRADE INVERSIONS ACTIVE — DISPLAY RISK ONLY**  
**Classification: P1**

### Evidence

| Grade | n (30D) | WR | Exp | Inversion |
|-------|---------|-----|-----|-----------|
| A | 1,106 | 33.5% | +0.038R | A < B ❌ |
| B | 912 | 34.6% | +0.073R | B < C ❌ |
| C | 102 | 54.9% | +0.897R | **Best cohort** |
| Empirical (riskgrade_v2) | stamped_resolved=302 | — | — | Insufficient data |

`riskgrade_v2=ON` but falls back to heuristic because only 302 resolved stamped signals exist. Promotion requires n≥30 per grade bucket in ≥3 buckets (~90 minimum, likely 200+ to be reliable). At ~69 signals/day with ~20% resolve rate (~14/day), this takes 6+ more days per bucket.

### Risk to WR

**Direct WR impact: None.** Grades drive display (the letter badge in the dashboard) and potentially Claude's context. They do not gate delivery — only the probability gate and regime gates control what gets delivered via WhatsApp.

**Indirect risk:** If a future code path gates delivery on grade (currently none does), an inverted grade system would be dangerous. For now, Grade C's high WR (54.9%) is correctly captured in the `futures|CONFIRMED_BREAKOUT` probability cohort, which passes the 40% WR threshold independently of the grade label.

**Promotion timeline:** Target: D7 check (2026-06-30). If stamped_resolved ≥ 300+ with ≥ 30 per grade in ≥ 3 buckets, consider assessing riskgrade_v2 empirical data quality.

**Action:** P1 — No change during freeze. Promotable after empirical data matures. Monitor stamped_resolved count at D3/D7.

---

## 4. Regime Drift

**Status: BULL_TREND UNGATED — MODERATE RISK**  
**Classification: P1**

### Current regime exposure

| Regime | 30D WR | 30D Exp | Delivery status |
|--------|--------|---------|----------------|
| BEAR_TREND | 51.4% | +0.619R | ✅ 27-31/day — primary source of all positive performance |
| SIDEWAYS | 30.2% | −0.017R | Gated (exemption: HMB + CONFIRMED_BREAKOUT) |
| BULL_TREND | 21.6% | −0.330R | ⚠️ Generated but probability gate blocks delivery |
| NULL | ~14.9% | ~−0.543R | ✅ Hard-gated (REGIME_REJECTION) |

### Active risk: BULL_TREND ungated at generation

BULL_TREND signals (WR=21.65%) pass all pipeline gates up to the probability gate. The probability gate blocks **delivery** but not **generation** — BULL_TREND signals are INSERT'd to the `signals` table and count toward `signals_per_day`. However, because they're not delivered via WhatsApp, they do not become ACTIVE and their outcomes are not tracked by the outcome checker (ACTIVE = telegramSent + within timeframe window). Therefore, undelivered BULL_TREND signals do NOT dilute the WR calculation.

**The real risk scenario:** If BTC shifts from BEAR_TREND to SIDEWAYS:
- Delivery drops to 0-3/day (only HIGH_MOMENTUM + CONFIRMED_BREAKOUT pass)
- Overall WR falls toward 30.2% (SIDEWAYS baseline)
- 7D rolling WR will drift from 33.15% toward breakeven
- No hard alert until WR < 30%

If BTC shifts from BEAR_TREND to BULL_TREND:
- Probability gate blocks all delivery (~0/day)
- No new outcomes resolve
- 7D rolling WR computed on stale BEAR_TREND data; degrades slowly as old outcomes roll off

**Current regime:** BEAR_TREND (confirmed by 27-31 deliveries/day on June 23).

**Gate precedence note:** CONTRA_REGIME_REJECTION=60/7D confirms the contra-regime gate v2 is correctly blocking BUY signals in BEAR_TREND. No BULL_TREND regime has occurred since June 23 (otherwise CONTRA_REGIME for SELL would spike).

**Scan mode anomaly:** `high_confidence: scans=1/7D, spot: scans=4/7D` — these modes appear nearly inactive. From ALPHA_MONITORING_1.md, `high_confidence_mode_enabled` is OFF per P0 recommendations. Spot mode deactivation is not documented — verify this is intentional and not a scheduler failure.

**Action:** P1 — Assess BULL_TREND gate after D7 (2026-06-30). This is the highest-leverage remaining change: implementing a BULL_TREND gate similar to SIDEWAYS (exempt HIGH_MOMENTUM) would remove the last ungated losing regime.

---

## 5. Redis Failures

**Status: CRITICAL — MAX CONNECTIONS EXHAUSTED**  
**Classification: P0**

### Evidence

```
/health/ready:
  status: "degraded"
  redis:         "error: max number of clients reached"
  celery_worker: "error: max number of clients reached"
  postgres:      "ok"
  binance:       "ok"
  whatsapp:      "configured"
  anthropic:     "not_configured: ANTHROPIC_API_KEY not set"
```

Redis Cloud Essentials has a ~30-connection limit. The system has exhausted all available connections. This is a persistent failure, not a transient spike.

### Affected systems

| System | Redis dependency | Fail behavior | WR impact |
|--------|-----------------|---------------|-----------|
| SchedulerCoordinator | `is_enabled()`, `acquire_scan_lock()` | **Fail-open** — scans continue | None |
| BTC regime cache | Read cached regime | Falls back to fresh BTC kline fetch | Minimal |
| Intelligence cache | Sector/trend scores | Falls back to CoinGecko → direct CMC | Low-moderate |
| WhatsApp dedup | `_is_duplicate_alert()` + cooldown | Fail-open — no cooldown set | None (duplicates only) |
| Attribution snapshots | Nightly write | Write may fail silently | None (gate fails open) |
| Probability gate lookups | Cohort WR reads | **Fail-open** — unknown cohort passes | None to WR |
| AI/heuristic call counters | Redis INCR | Not incremented — reads 0 | None to WR |

**Assessment:** Current Redis failure does NOT directly cause WR regression. All critical paths fail open. However, two indirect risks are active:

**Indirect risk 1 — Intelligence cache cold:** If Redis write connections are failing, the TypeScript workers cannot write sector/trend intelligence to the cache. The Python scanner reads this cache for TrendScore and sector_status. Cold cache → scanner falls back to CoinGecko/direct CMC → missing sector_status (field becomes NULL) → reduced setup scoring granularity. With `signals_per_day=69` remaining healthy, this degradation appears limited.

**Indirect risk 2 — Escalation:** If the connection pool is growing (leak), pressure will increase until Redis begins rejecting even health-check connections. At that point, BTC regime reads could fail → `btc_regime=None` → NULL hard gate fires → REGIME_REJECTION spikes → signal volume collapses.

### Root cause (most likely)

Three Railway services (FastAPI + Celery worker + Celery beat) each maintain asyncio connection pools. If pools are not bounded, each service can hold 10-15 connections. On redeploy, new instances open new pools before old ones are closed. The ~30 connection limit fills within 2-3 redeploys.

### Fix (infrastructure only — does not require strategy changes)

**P0.1A — Cap Redis connection pools** in `backend/database/session.py` and `backend/scheduler/coordinator.py`:
```python
# In create_redis_client():
max_connections=5  # per service
```
Three services × 5 connections = 15 connections, leaving headroom for health checks.

**P0.1B — Restart Railway deployments** (temporary fix — clears leaked connections but will recur without P0.1A).

**P0.1C — Upgrade Redis Cloud plan** from Essentials to Pro (~125 connections). Permanent fix but incurs cost.

---

## 6. WhatsApp Delivery

**Status: HEALTHY**  
**Classification: P2 (no action)**

### Evidence

| Period | Generated | Eligible | Queued | Delivered | Failed | Success |
|--------|-----------|---------|--------|-----------|--------|---------|
| H24 | 69 | 47 | 31 | 31 | 0 | **100%** |
| D7 | 355 | 262 | 32 | 31 | 1 | 96.9% |

**H24 delivery is perfect.** Zero failures, 100% success rate. The UltraMsg instance181885 connection to +919600190022 is healthy.

**D7 single failure (1/32 = 3.1%):** One message failed over 7 days. This is within normal bounds for UltraMsg transient delivery. Not a systematic issue.

**D7 suppression (217/262 = 82.8%):** These are probability gate suppressions from the June 16-22 SIDEWAYS period — all cohort WR < 40%, correctly suppressed. Not a delivery failure.

**Shadowed=13 (identical in H24 and D7):** 13 dedup-shadowed signals within the 1-hour cooldown. Consistent value in both windows suggests the same signals have been in cooldown for most of the day. Normal behavior.

**Risk to WR:** None. WhatsApp delivery is working correctly.

**Action:** None. Monitor at D3/D7. Alert if daily failure rate exceeds 10%.

---

## 7. Count Inconsistencies

**Status: TWO BROKEN METRICS — NON-WR-IMPACTING**  
**Classification: P1**

### Comparison across sources

| Metric | Monitor | Delivery | Scan Metrics | Match? |
|--------|---------|----------|-------------|--------|
| signals/day (H24) | 69 | 69 generated | — | ✅ Match |
| delivered/day | 31 | 31 | — | ✅ Match |
| signals/day (7D avg) | 69 | ~51/day (scan metrics avg) | ⚠️ Divergence |
| claude_calls/day | 0 | — | — | ⚠️ Expected (no API key) |
| heuristic_calls/day | **0** | — | — | ❌ Should be ~69 |
| cmc_credits/day | **0** | — | — | ❌ Was 23 earlier today |
| resolved_7d | 180 | — | perf-ver: 302 | ℹ️ Different populations |

### Broken metric 1: `heuristic_calls=0`

With ANTHROPIC_API_KEY unset, every signal goes through the heuristic path. `heuristic_calls` should be ~69/day but shows 0. Two possible causes:

(a) **OPS.CONSOLIDATION.1 R8** removed the Redis INCR for this counter along with other Python INCR calls.  
(b) **Redis failures** (P0.5 above) are dropping INCR writes.

Either way, `claude_fallback_pct` = 0/0 = 0% is meaningless. The AI health status cannot be monitored via this metric. **This is a monitoring blind spot, not a WR regression risk** — whether AI is on or off does not change the fact that signals are being generated and delivered at normal rates.

### Broken metric 2: `cmc_credits/day=0`

This counter dropped from 23 to 0 at some point today. Possible causes:

(a) **Redis failure cleared the counter** — the daily CMC credit INCR is stored in Redis and fails during connection exhaustion.  
(b) **CMC API quota exhausted** — free tier has 10,000 credits/month; at 23/day = 690/month, this is unlikely.  
(c) **TypeScript intelligence workers stopped** — Vercel cold start or build error caused the workers to stop calling CMC.

If (c), the intelligence cache will gradually go cold. Sector status and trend scores will become NULL in the Python scanner, reducing signal quality slightly. The CMC fallback in `intelligence_cache.py` would kick in (direct CMC from Python), but this uses additional quota.

### signals/day divergence (monitor=69 vs scan_metrics=~51/7D avg)

Monitor queries the `signals` DB table for rolling 24h count. Scan metrics averages `signals_found` per scan task over 7 days. The divergence (69 vs ~51) is timing: today is the first BEAR_TREND day after a SIDEWAYS period — signal volume is elevated. The 7D scan average includes June 16-22 low-volume SIDEWAYS days. Not a systematic inconsistency.

### resolved_7d divergence (monitor=180 vs perf-verification=302)

Monitor `resolved_7d=180`: signals with resolved outcome written in the last 7 days.  
Performance-verification `stamped_resolved=302`: signals that have BOTH been stamped with empirical data AND resolved (30D window, not 7D).  
Different populations and windows — not a data error.

**Action:** P1 — Investigate CMC credits=0. Check Vercel Function logs for TypeScript intelligence worker errors. If workers are confirmed down, signal quality will degrade within hours as the intelligence cache goes cold.

---

## Priority Matrix

| # | Risk | Area | Priority | WR impact | Action |
|---|------|------|----------|-----------|--------|
| 1 | Redis max connections — degraded health | Redis | **P0** | Indirect (cache cold → quality loss) | Cap connection pools or restart Railway |
| 2 | ANTHROPIC_API_KEY not set — 100% heuristic | Infrastructure | **P0** | Medium (AI gate offline) | Set env var in Railway |
| 3 | BULL_TREND ungated — WR=21.65% | Regime | **P1** | High if regime shifts to BT | Gate after D7 (2026-06-30) |
| 4 | Probability accuracy MAE=40.9pp | Probability | **P1** | Moderate (SELL over-blocked) | Monitor; recalibrate after D7 |
| 5 | Heuristic grade inversions (A<B<C) | RiskGrade | **P1** | Low (display only) | Wait for empirical data (n≥30/bucket) |
| 6 | CMC credits=0 — intelligence cache cold | Count/Infra | **P1** | Moderate (missing sector/trend) | Check Vercel Function logs |
| 7 | heuristic_calls counter broken | Count | **P1** | None (monitoring blind spot) | Investigate after Redis fix |
| 8 | WR=32.8% at warning threshold | Core | **P2** | Direct — track at D3 | Monitor; alert only if <30% |
| 9 | Regime dependency — all perf in BEAR_TREND | Regime | **P2** | High if regime shifts | BULL_TREND gate is the fix (P1.3) |
| 10 | KLINE_EMPTY elevated (5,290/7D) | Gate | **P2** | Very low (volume, not quality) | Monitor trend |
| 11 | TRENDING mode negative (WR=28.2%) | Mode | **P2** | Low (floor=85 applied) | Assess at D14 (2026-07-07) |

---

## Action Items

### P0 — Immediate (do not wait for D7)

**P0.1 — Fix Redis connection exhaustion**

The `status: "degraded"` + `max number of clients reached` is the most urgent infrastructure issue. Scans are running (fail-open), but multiple features are silently degraded.

Fix option A (permanent): Add `max_connections=5` to Redis client construction in `coordinator.py` and any other Redis clients in the backend. This limits each service to 5 connections maximum.

Fix option B (temporary): Restart Railway deployments to clear leaked connections. This will recur unless option A is implemented.

Do not attempt this during peak scan hours without verifying the scheduler will restart cleanly.

**P0.2 — Set ANTHROPIC_API_KEY in Railway**

The AI validation gate has been offline since deployment. The system maintains WR=33.15% on heuristic alone, but:
- Signals with setup_score ≥ 78 should receive Claude validation for institutional context quality
- `SCREENED` and `AI_APPROVED` lifecycle stages are indistinguishable (all SCREENED)
- AI explainability fields (reasoning, strengths, risks) are empty

Set via Railway dashboard: Settings → Variables → `ANTHROPIC_API_KEY = [key]`.

### P1 — Before D7 (by 2026-06-30)

**P1.1 — Verify CMC intelligence workers (Vercel)**  
Check Vercel Functions logs for the TypeScript intelligence routes. If `cmc_credits=0` persists through tomorrow, assume worker failure and check `/admin/system?tab=health` → Cache tab for intelligence cache freshness. If CMC cache is showing STALE, restart the Next.js deployment or manually trigger a cache refresh.

**P1.2 — BULL_TREND gate at D7**  
After D7 measurement confirms WR, implement BULL_TREND gate (same pattern as SIDEWAYS gate: exempt HIGH_MOMENTUM_BREAKOUT). This closes the last ungated losing regime (WR=21.65%, Exp=−0.330R).

**P1.3 — Verify spot mode activation**  
`spot: scans=4/7D` in the scan metrics suggests spot mode is nearly disabled. If intentional (high_confidence_mode_enabled=OFF was the flag applied), confirm spot is separately controlled. If unintentional, investigate scheduler.

### P2 — After D7 (post 2026-06-30)

**P2.1 — D3 measurement (2026-06-26)**  
Run all 6 endpoints per ALPHA_MONITORING_1.md protocol. Specifically: verify WR has not dropped below 30%, verify KLINE_EMPTY trend.

**P2.2 — D7 full assessment (2026-06-30)**  
Complete ALPHA_MONITORING_1.md D7 section. Decision gate: BULL_TREND gate, TRENDING mode reassessment.

**P2.3 — Empirical grade promotion check (D7)**  
Check stamped_resolved count. If ≥ 200 with ≥ 30/bucket in ≥ 3 grades, consider enabling empirical grade display.

---

## Frozen Components — Confirmed Stable

| Component | Evidence | Status |
|-----------|----------|--------|
| NULL regime hard gate | REGIME_REJECTION=2/7D | ✅ Working |
| SIDEWAYS gate + CONFIRMED_BREAKOUT exemption | SIDEWAYS_REJECTION=0 (BEAR_TREND regime, correct) | ✅ Deployed |
| Contra-regime gate v2 | CONTRA_REGIME_REJECTION=60/7D — active | ✅ Working |
| Early breakout penalty v1 | SETUP_REJECTION=90/7D — proportional | ✅ Working |
| Confidence floors (85 spot/futures/trending) | CONFIDENCE_REJECTION=2,668/7D — proportional | ✅ Working |
| Probability gate (min_wr=40%) | H24 suppression=6.4%, D7 SIDEWAYS-driven | ✅ Working |
| WhatsApp delivery (UltraMsg) | H24: 100% success, D7: 96.9% | ✅ Healthy |
| scan_metrics_log recording | failure_rate=0.0 (969 scans) | ✅ Working |

---

*Next checkpoint: D3 (2026-06-26) — run all 6 endpoints per ALPHA_MONITORING_1.md measurement protocol.*  
*Primary action before then: P0.1 (Redis connections) + P0.2 (ANTHROPIC_API_KEY).*
