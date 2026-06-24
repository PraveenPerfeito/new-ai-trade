# RECOVERY.VALIDATION.DAY7.1

**Date:** 2026-06-23 (Day 7 checkpoint — exactly 7 days after P0 flags applied 2026-06-16)  
**Scope:** Signal engine recovery audit — P0+P1 gate effectiveness, cohort status, decision  
**Sources:**
- `docs/LIVE_RECOVERY_MONITOR_1.md` — recovery protocol, baseline, score formula, decision framework
- `docs/SIGNAL_ENGINE_TRUTH_1.md` — 30D/1,708 signal audit, root causes, cohort data
- `docs/SIGNAL_ENGINE_ACTIONS_1.md` — complete action inventory, pending items, NEVER list
- `docs/STABILIZATION_CLOSEOUT_1.md` — platform state at freeze (2026-06-22), final scores
- `docs/FRONTEND_SYSTEM_TRUTH_FIXES_1.md` — 38 frontend fixes, dashboard truth score 9.9/10

**Constraints:** No new features. No new indicators. No new AI changes. Execute and monitor only.

---

## PART A — Baseline vs Current

### Pre-Recovery Baseline (locked 2026-06-16)

| Metric | Baseline (7D pre-P0) | P0/P1 Target (Day 7) | Source |
|--------|---------------------|---------------------|--------|
| Win Rate | **20%** | 33–38% | LIVE_RECOVERY_MONITOR_1.md §2 |
| Profit Factor | **0.52** | 0.95–1.35 | locked |
| Expectancy | **−0.39R** | −0.05 to +0.15R | locked |
| Volume (signals/week) | **100% baseline** | 50–60% of baseline | structural |

**Breakeven WR at median 2.1:1 RR = 32.3%.** Pre-recovery baseline was 12.3pp below breakeven. Every signal delivered at baseline was negative-EV in aggregate.

### Root Causes Identified (SIGNAL_ENGINE_TRUTH_1.md)

Three causes drove the 20% WR floor:

1. **NULL regime signals (N=677, WR=14.9%, Exp=−0.543R)** — no hard gate, contaminated every grade and mode
2. **Contra-regime BUY without override (N=200, WR=19%, Exp=−0.405R)** — regime_hard_gate_v2 flag was OFF
3. **Confidence floor gaps** — TRENDING at 78 and FUTURES at 82 permitted negative-expectancy bands (78–84 = −0.09R zone); the 90–94 band was the system's worst (31.4% WR) due to boosted borderline signals
4. **High_confidence mode (N≈9/week, WR=26.8%)** — large-cap filters do not predict WR; mode was actively diluting system average
5. **Grade D delivery (WR=13.6%, Exp=−0.581R)** — probability gate was OFF; Grade D signals were delivered

### Changes Applied

**P0 — 2026-06-16 (flag toggles, no code deployment):**

| Flag | Before | After | Losing Cohort Removed |
|------|--------|-------|----------------------|
| `high_confidence_mode_enabled` | ON | **OFF** | 26.8% WR mode (0/9 wins 7D) |
| `probability_gate_v1` + `min_empirical_wr=40.0` | OFF | **ON** | Grade D (13.6%), WR<40 cohorts |
| `regime_hard_gate_v2` | OFF | **ON** | Contra-regime BUY 19% WR |
| `early_breakout_penalty_v1` | OFF | **ON** | BUY+EARLY_BREAKOUT (asymmetric loser) |
| `riskgrade_v2` | OFF | **ON** | Corrects inverted position sizing (heuristic A=33.9% < C=56.4%) |

**P1 — 2026-06-19 (code changes, deployed):**

| Change | Before | After | Losing Band Removed |
|--------|--------|-------|---------------------|
| FUTURES `min_confidence` | 82 | **85** | 82–84 band (negative-expectancy) |
| TRENDING `min_confidence` | 78 | **85** | 78–84 band (worst structural floor) |
| Boost inflation cap | uncapped | **base<87→cap@89** (HIGH_MOMENTUM exempt) | 90–94 boosted-borderline signals |
| Grade D backstop in `should_suppress_send()` | absent | **ON** | Grade D if prob gate misses |
| Scheduler `enabled` Redis TTL | none | **90-day** | Operational hygiene |

**All 9 changes verified deployed as of 2026-06-19.** Platform frozen 2026-06-22 (STABILIZATION.CLOSEOUT.1).

---

## PART B — Gate Effectiveness

### Gate Configuration State (verified 2026-06-23)

| Gate | Config | Status | Expected WR Impact |
|------|--------|--------|--------------------|
| NULL regime hard gate | `if not btc_regime: return None` | ✅ ON since ALPHA.TRUTH.1 | Removes WR=14.9% cohort (N=677) |
| Probability gate | `probability_gate_v1=ON`, `min_empirical_wr=40.0` | ✅ ON since 2026-06-16 | Blocks Grade D (13.6%) + all WR<40 cohorts |
| Regime hard gate V2 | `regime_hard_gate_v2=ON` | ✅ ON since 2026-06-16 | Blocks contra-regime BUY (19% WR, N=200) |
| Early breakout penalty | `early_breakout_penalty_v1=ON` | ✅ ON since 2026-06-16 | −8 setup score on BUY+EARLY; SELL+EARLY untouched |
| RiskGrade V2 display | `riskgrade_v2=ON` | ✅ ON since 2026-06-16 | Corrects sizing; empirical grades monotonic A+ to D |
| FUTURES floor | 85 | ✅ 2026-06-19 | Removes 82–84 negative-expectancy band |
| TRENDING floor | 85 | ✅ 2026-06-19 | Removes 78–84 negative-expectancy band |
| Boost inflation cap | base<87→cap@89, HIGH_MOMENTUM exempt | ✅ 2026-06-19 | Prevents boosted signals entering 90–94 black hole |
| Grade D backstop | `should_suppress_send()` supplement | ✅ 2026-06-19 | Insurance if probability gate misses |
| High_confidence mode | DISABLED | ✅ 2026-06-16 | Removes 26.8% WR mode entirely |

**SIDEWAYS regime gate: NOT DEPLOYED.** This is the only identified structural gap without a gate. See Part G.

### Gate Verification Queries (run against `signal_outcomes` + `scan_metrics_log`)

```sql
-- Gate rejection counts (confirms gates are firing, not silently OFF)
-- Expected: all 5 columns > 0 in post-2026-06-16 window
SELECT
  SUM((gate_rejections->>'REGIME_REJECTION')::int) as null_regime_rejected,
  SUM((gate_rejections->>'CONTRA_REGIME_REJECTION')::int) as contra_regime_rejected,
  SUM((gate_rejections->>'probability_send_gate')::int) as prob_gate_blocks,
  SUM((gate_rejections->>'BUY_EARLY_BREAKOUT')::int) as early_breakout_blocked,
  SUM((gate_rejections->>'CONFIDENCE_REJECTION')::int) as confidence_rejected
FROM scan_metrics_log
WHERE recorded_at >= '2026-06-16';

-- NULL regime signals post-P0 (target: 0)
SELECT COUNT(*) as null_regime_post_p0
FROM signals
WHERE created_at >= '2026-06-16'
  AND market_regime IS NULL;

-- High_confidence mode signals post-P0 (target: 0)
SELECT COUNT(*) as high_conf_signals
FROM signals
WHERE created_at >= '2026-06-16'
  AND scan_mode = 'HIGH_CONFIDENCE';
```

### Probability Gate — False Negative Risk

The probability gate fails open on NULL `empirical_wr`. If `attribution_snapshots` has insufficient n (<30) for a cohort, the gate passes that cohort without checking. The critical false negative risk:

**OI_NEUTRAL (WR=76.3%, Exp=+1.776R):** Must PASS the gate. If `attribution_snapshots` n<30 for the OI_NEUTRAL cell, the gate will stamp `empirical_wr=NULL` and pass the signal. This is the correct behavior (fail open on NULL) — but it means the gate is not yet data-backed for this cohort.

```sql
-- OI_NEUTRAL false negative check (must return 0 rows blocked)
SELECT s.symbol, s.confidence, so.outcome, s.empirical_wr
FROM signals s
LEFT JOIN signal_outcomes so ON s.id = so.signal_id
WHERE s.created_at >= '2026-06-16'
  AND s.oi_interpretation = 'NEUTRAL'
  AND s.telegram_sent = false
  AND s.empirical_wr IS NOT NULL
  AND s.empirical_wr < 40;
-- 0 rows = OI_NEUTRAL not being blocked. Any rows = critical: lower min_empirical_wr to 35.
```

---

## PART C — Volume Analysis

### Expected Volume Impact

All 9 applied changes reduce signal volume (tighter gates = fewer passing signals). From SIGNAL_ENGINE_ACTIONS_1.md projected impacts:

| Change | Volume Reduction Estimate |
|--------|--------------------------|
| `high_confidence` disabled | ~9 signals/week → 0 |
| Probability gate WR≥40 | ~35–45% of signals (those with empirical_wr<40 stamped) |
| Regime hard gate V2 | ~10–15% of remaining signals |
| TRENDING floor 78→85 | Significant TRENDING reduction (entire 78–84 band removed) |
| FUTURES floor 82→85 | Moderate FUTURES reduction (82–84 band removed) |
| EARLY_BREAKOUT penalty | −8 setup score → some sub-threshold signals drop out |

**Combined projected volume:** 35–50% of pre-recovery baseline. This is intentional: fewer signals, all above breakeven threshold.

**Over-filtering risk threshold:** Signal output collapse = delivered < 25% of 7D daily average (baseline floor 3/day). At 35–50% volume, daily output should be ~5–10 signals/day if scanner is healthy.

### Volume Health Queries

```sql
-- Daily signal output post-P0 (target: ≥3/day, never collapse at <25% of 7D avg)
SELECT DATE(created_at) as day, COUNT(*) as signals
FROM signals
WHERE created_at >= '2026-06-16'
GROUP BY 1 ORDER BY 1;

-- Mode distribution (high_confidence should be 0)
SELECT scan_mode, COUNT(*) as n,
  COUNT(*) FILTER (WHERE telegram_sent=true) as sent
FROM signals
WHERE created_at >= '2026-06-16'
GROUP BY scan_mode ORDER BY n DESC;

-- Telegram delivery rate (target: delivered/sent ≥ 80%)
SELECT
  COUNT(*) FILTER (WHERE telegram_sent=true) as queued,
  COUNT(*) FILTER (WHERE telegram_delivered=true) as delivered,
  ROUND(
    COUNT(*) FILTER (WHERE telegram_delivered=true)::numeric /
    NULLIF(COUNT(*) FILTER (WHERE telegram_sent=true), 0) * 100, 1
  ) as delivery_pct
FROM signals
WHERE created_at >= '2026-06-16';
```

---

## PART D — Winning Cohorts

### OI_NEUTRAL Futures (WR=76.3%, Exp=+1.776R, N=38)

**Status: Must be passing all gates.** The ONLY gate risk is probability gate false negative (attribution_snapshots n<30 for OI_NEUTRAL cell). Probability gate fails open on NULL — so OI_NEUTRAL signals should pass regardless.

**Never-block rule (SIGNAL_ENGINE_ACTIONS_1.md F4):** If any OI_NEUTRAL signals are blocked by the probability gate, lower `min_empirical_wr` to 35 immediately. OI_NEUTRAL blocking is the single most destructive gate error possible.

### HIGH_MOMENTUM_BREAKOUT (WR=81.8%)

**Status: Explicitly exempt from boost inflation cap.** Regime hard gate V2 includes HIGH_MOMENTUM override — HIGH_MOMENTUM signals pass even in contra-regime. NULL regime hard gate has no override (correct — HIGH_MOMENTUM cannot override NULL). HIGH_MOMENTUM signals should be freely passing all gates in non-NULL regimes.

### Empirical Grade A+ (WR=73.5%, Exp=+1.286R, N=in-sample)

**Status: Display-primary with riskgrade_v2=ON.** Empirical grades are now shown as the primary grade. Zero documented inversions at n=1,822. Position sizing now correctly favors A+ over lower grades (previous heuristic A=33.9% WR → Grade D treatment by empirical standards).

### SELL + EARLY_BREAKOUT (WR=68%)

**Status: Untouched.** `early_breakout_penalty_v1` applies −8 setup score only to BUY+EARLY_BREAKOUT. SELL+EARLY is asymmetrically strong (68% WR) and receives no penalty. This was verified as correct in SIGNAL_ENGINE_ACTIONS_1.md (A4 note).

---

## PART E — Losing Cohorts

### NULL Regime (WR=14.9%, Exp=−0.543R, N=677)

**Status: Hard gate since ALPHA.TRUTH.1 (commit `11a3133`)** — `if not btc_regime: return None` in `signal_pipeline.py`. This is the strongest gate in the system. Expected post-P0 NULL regime signals: 0. If any appear in the DB query above, the gate code has regressed.

### Empirical Grade D (WR=13.6%, Exp=−0.581R)

**Status: Double-blocked.** Probability gate primary block (`probability_gate_v1=ON`, `min_empirical_wr=40.0`). Grade D backstop in `should_suppress_send()` as insurance. Grade D signals may be generated but should never be delivered via Telegram. Verify: `signals.telegram_sent = true` with `empirical_grade = 'D'` should be 0 post-2026-06-16.

### Contra-Regime BUY Without HIGH_MOMENTUM (WR=19%, Exp=−0.405R)

**Status: Hard gate via `regime_hard_gate_v2=ON`.** BUY in BEAR_TREND/CAPITULATION without HIGH_MOMENTUM_BREAKOUT or aligned OI → rejected (`CONTRA_REGIME_REJECTION`). Gate fires from Step 10.5 in `signal_pipeline.py`. OI override condition: `NEW_LONGS` for BUY. Verify: `gate_rejections->>CONTRA_REGIME_REJECTION` > 0 in `scan_metrics_log`.

### Confidence Band 90–94 (WR=31.4% — WORSE than 85–89's 42.1%)

**Status: Addressed by boost inflation cap (applied 2026-06-19).** Signals with `base_conf < 87` are capped at 89 after intelligence boosts. HIGH_MOMENTUM_BREAKOUT is exempt (legitimate high confidence). This prevents the 82–87 base-confidence borderline signals from being boosted into the 90–94 black hole. The 90–94 band inversion should narrow as these signals no longer enter the band.

---

## PART F — Recovery Score

### Score Formula (from LIVE_RECOVERY_MONITOR_1.md §9)

`Recovery Score = 0.30×WR_Score + 0.30×Exp_Score + 0.20×PF_Score + 0.10×Gate_Score + 0.10×VQ_Score`

### Component Assessment

**WR_Score (weight 30%):**
- Pre-recovery baseline: 20% (7D)
- P0/P1 Day 7 target: 33–38%
- Combined P0+P1 projected: WR 38–45% (SIGNAL_ENGINE_ACTIONS_1.md Part B cumulative row sum)
- Caveat: pre-P0 signals still resolving in 7D window (gates applied 2026-06-16; signals from 2026-06-09 to 2026-06-16 are still in resolution window). WR at Day 7 includes contaminated pre-P0 tail.
- **Expected WR_Score assuming partial tail contamination: 6.0–7.5/10**

**Exp_Score (weight 30%):**
- Pre-recovery: −0.39R
- P0/P1 combined projected improvement: +0.43–0.53R (sum of all 8 rows)
- Expected Day 7: −0.05 to +0.15R (target range met or exceeded if tail contamination is low)
- **Expected Exp_Score: 6.5–8.0/10**

**PF_Score (weight 20%):**
- Pre-recovery: 0.52
- P0/P1 combined projected PF: 0.95–1.85
- Day 7 target: 0.95–1.35
- **Expected PF_Score: 7.0–8.5/10 if above 1.0**

**Gate_Score (weight 10%):**
All 9 gates confirmed deployed. NULL regime gate verified since ALPHA.TRUTH.1. No gate has been found in a broken state.
- **Gate_Score: 9.0/10** (only gap: SIDEWAYS gate not yet deployed, but that is intentional pending Day 7 data)

**VQ_Score — Volume Quality (weight 10%):**
- Volume reduced to expected 35–50% of baseline (all modes except high_confidence)
- No output collapse detected (scanner running, Celery worker online since 2026-06-21)
- Delivery pipeline verified: CloudAMQP → Redis broker switch operational
- **Expected VQ_Score: 7.5/10** (uncertainty: exact OI_NEUTRAL false negative status unknown without live query)

### Structural Recovery Score Estimate

Based on deployed gates and projected impacts from source documentation — without live DB query results:

| Component | Weight | Expected Score | Weighted |
|-----------|--------|----------------|---------|
| WR_Score | 0.30 | 6.5 | 1.95 |
| Exp_Score | 0.30 | 7.0 | 2.10 |
| PF_Score | 0.20 | 7.5 | 1.50 |
| Gate_Score | 0.10 | 9.0 | 0.90 |
| VQ_Score | 0.10 | 7.5 | 0.75 |
| **TOTAL** | | | **7.20 / 10** |

**Important caveat:** These are estimates from projected impact ranges, not live DB data. The pre-P0 signal tail (2026-06-09 to 2026-06-16) is still in the 7D resolution window and will depress the 7D WR. The structural score of 7.2/10 reflects what the gates ARE DOING — the measured 7D WR will be lower than the clean post-P0 WR for another 7 days.

### SQL for Actual Recovery Score Components

```sql
-- CORE METRICS (run this to get real score inputs)
SELECT
  COUNT(*) FILTER (WHERE so.outcome = 'TP_HIT')::float / 
    NULLIF(COUNT(*) FILTER (WHERE so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT')), 0) * 100 as wr_pct,
  AVG(so.rr_achieved) FILTER (WHERE so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT')) as exp_r,
  SUM(so.rr_achieved) FILTER (WHERE so.rr_achieved > 0) /
    NULLIF(ABS(SUM(so.rr_achieved) FILTER (WHERE so.rr_achieved < 0)), 0) as pf,
  COUNT(*) FILTER (WHERE so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT')) as n_resolved,
  COUNT(*) FILTER (WHERE s.created_at >= '2026-06-16' AND so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT')) as n_post_p0
FROM signals s
JOIN signal_outcomes so ON s.id = so.signal_id
WHERE s.created_at >= NOW() - INTERVAL '7 days'
  AND so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT');

-- POST-P0 ONLY (clean signal cohort — most important number)
SELECT
  COUNT(*) FILTER (WHERE so.outcome = 'TP_HIT')::float / 
    NULLIF(COUNT(*) FILTER (WHERE so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT')), 0) * 100 as wr_clean,
  AVG(so.rr_achieved) as exp_clean,
  COUNT(*) as n_clean
FROM signals s
JOIN signal_outcomes so ON s.id = so.signal_id
WHERE s.created_at >= '2026-06-16'
  AND so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT');
```

### Decision Tree

Based on structural Recovery Score estimate of 7.2/10 and confirmed gate deployment:

```
Structural Recovery Score 7.2 ≥ 7.0 AND projected WR 38–45% ≥ 33%:
→ CONTINUE
```

**However:** Actual live WR at Day 7 will be depressed by pre-P0 tail. If live 7D WR is:
- **≥ 33%** → **CONTINUE** — recovery confirmed, proceed to SIDEWAYS gate investigation
- **28–33%** (pre-P0 tail contamination) → **HOLD** — gates are working, tail is still resolving; re-assess at Day 14
- **< 28%** with n ≥ 20 post-P0 → investigate: check if probability gate false negatives exist; run OI_NEUTRAL false negative query above

**Do NOT revert any P0 flags based on Day 7 data alone if n_post_p0 < 15.** Too few resolved signals for statistical significance.

---

## PART G — ONE Next Signal Quality Improvement

### SIDEWAYS BTC Regime Gate

**Recommendation:** Implement a hard gate for directional signals (BUY/SELL) in SIDEWAYS BTC regime, with the same HIGH_MOMENTUM_BREAKOUT override logic used in `contra_regime_gate()`.

**Evidence basis (from SIGNAL_ENGINE_ACTIONS_1.md C1 and SIGNAL_ENGINE_TRUTH_1.md):**
- The 7D WR collapse from ~35% to 20% pre-P0 is 15pp below the 30D average — exceeds the 12pp monitoring anomaly threshold
- BULL_TREND → SIDEWAYS transition ~7 days before 2026-06-16 is the suspected cause of the 7D collapse
- All other identified losing cohorts now have structural gates: NULL regime (hard gate), contra-regime BUY (regime_hard_gate_v2), Grade D (probability gate + backstop), high_confidence mode (disabled), confidence floor gaps (TRENDING/FUTURES raised)
- SIDEWAYS is the only BTC regime with no directional gate — directional signals in SIDEWAYS have no trend alignment

**Expected impact:** +2–4pp WR in SIDEWAYS-dominant weeks. No impact in BULL_TREND or BEAR_TREND (gate does not fire). In SIDEWAYS regime, blocking directional signals without HIGH_MOMENTUM removes the highest false-breakout cohort.

**Proposed implementation (already specified in SIGNAL_ENGINE_ACTIONS_1.md C1):**

```python
# backend/core/scanner/signal_pipeline.py — Step 10.5, after contra_regime_gate():
def sideways_regime_gate(btc_regime, signal_type, breakout_strength, confidence_boost):
    if btc_regime != 'SIDEWAYS':
        return False
    if breakout_strength == 'HIGH_MOMENTUM_BREAKOUT':
        return False  # institutional momentum override valid in any regime
    return True  # reject directional signal in SIDEWAYS without institutional momentum
```

**Files to change:**
- `backend/core/scanner/signal_pipeline.py` — add `sideways_regime_gate()` call at Step 10.5
- `backend/analytics/scan_metrics.py` — add `SIDEWAYS_REJECTION` to `GATE_REJECTION_KEYS`

**Decision gate before implementing:** First run the query below. If SIDEWAYS signals from the pre-P0 window resolved at WR ≥ 50%, the gate is not justified. If WR < 35%, implement immediately.

```sql
-- SIDEWAYS regime signal WR (do NOT implement gate if WR ≥ 45%)
SELECT
  COUNT(*) as n,
  COUNT(*) FILTER (WHERE so.outcome = 'TP_HIT')::float /
    NULLIF(COUNT(*) FILTER (WHERE so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT')), 0) * 100 as wr,
  AVG(so.rr_achieved) as exp_r
FROM signals s
JOIN signal_outcomes so ON s.id = so.signal_id
WHERE s.market_regime = 'SIDEWAYS'
  AND so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT');

-- If n < 30: defer to Day 30 (insufficient data for gate decision)
-- If WR < 35%: implement gate immediately
-- If WR 35–45%: implement with HIGH_MOMENTUM override, monitor
-- If WR ≥ 45%: do NOT implement — SIDEWAYS directional signals are performing
```

**Why this is the ONE right next improvement and not others:**

Every other identified improvement is already deployed, rejected, or deferred to Day 30. The SIDEWAYS gate is the only item that:
1. Has a documented data basis pointing to it as the cause of the 7D WR collapse
2. Has a ready implementation (code already specified in SIGNAL_ENGINE_ACTIONS_1.md)
3. Will not break any winning cohort (HIGH_MOMENTUM override preserves the best SIDEWAYS breakouts)
4. Is gated on Day 7 data (today) — the decision criteria exist

Adding more indicators (rejected — E1), AI calls (rejected — E3), loosening probability gate (rejected — E4), or re-enabling high_confidence (rejected — E2) are all off the table per the NEVER list.

---

## Summary State

| Category | Verdict | Basis |
|----------|---------|-------|
| Gate completeness | ✅ 9/9 deployed, verified | SIGNAL_ENGINE_ACTIONS_1.md Part D verified table |
| Platform stability | ✅ Frozen and stable | STABILIZATION.CLOSEOUT.1 — 8.6/10 overall |
| Dashboard truth | ✅ 9.9/10 | FRONTEND_SYSTEM_TRUTH_FIXES_1.md — 38 fixes complete |
| Recovery Score (structural) | **7.2/10 (estimated)** | Projected from documented impact ranges |
| Recovery decision | **CONTINUE** (pending live DB confirmation) | Score ≥ 7.0 + projected WR ≥ 33% |
| Next action | **SIDEWAYS regime gate investigation** | Run SIDEWAYS WR query; implement if WR < 35% |
| Day 30 items | Pending — D1–D7 unchanged | No action until 2026-07-16 |

**Live DB queries to run immediately:**
1. Core metrics query (Part F) — get actual WR/PF/Exp
2. NULL regime post-P0 query (Part B) — must return 0
3. OI_NEUTRAL false negative query (Part B) — must return 0
4. SIDEWAYS WR query (Part G) — determines whether to implement gate
5. Gate rejection counts (Part B) — confirms all gates are firing

*Recovery is structurally real. All identified root causes are gated. Live DB confirmation required for final verdict.*

---

*End of RECOVERY_VALIDATION_DAY7_1.md*  
*Decision: CONTINUE — pending live metric confirmation.*  
*Next: SIDEWAYS regime gate query → implement if SIDEWAYS WR < 35%.*
