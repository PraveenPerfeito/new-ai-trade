# LIVE_RECOVERY_MONITOR_1.md

**Recovery Start:** 2026-06-16  
**P0 Flags Applied:** 2026-06-16 (commits `caa3948` / `acb1514`)  
**First Checkpoint:** 2026-06-23 (Day 7)  
**P1 Decision Window:** 2026-06-23 to 2026-06-30  
**Monitoring Owner:** Founder / Principal Quant  
**Data Basis:** `signal_outcomes` + `attribution_snapshots` + `gate_rejections` per scan  
**Read alongside:** `SIGNAL_QUALITY_AUDIT_3.md` · `PERFORMANCE_VERIFICATION_1.md` · `CONFIDENCE_CALIBRATION_2.md`

---

## P0 Configuration Snapshot

Flags applied at recovery start:

| Flag | Before | After | Mechanism |
|---|---|---|---|
| `high_confidence_mode_enabled` | ON | **OFF** | Eliminates mode with 0/9 7D wins |
| `probability_gate_v1` | OFF | **ON** | Telegram delivery gated at empirical_wr ≥ 40 |
| `scanner.min_empirical_wr` | — | **40.0** | Gate threshold |
| `regime_hard_gate_v2` | OFF | **ON** | Hard rejects contra-regime BUY/SELL without HIGH_MOMENTUM override |
| `early_breakout_penalty_v1` | OFF | **ON** | −8 setup score for BUY + EARLY_BREAKOUT |
| `riskgrade_v2` | OFF | **ON** | Empirical grades as primary display (corrects position sizing) |

No code deployed. All changes are flag toggles via Admin → System → Settings → Feature Flags.

---

## Pre-Recovery Baseline (LOCKED 2026-06-16)

These numbers are fixed at the time P0 was applied. All comparisons are made against this baseline.

### Performance

| Window | WR | PF | Expectancy | Status |
|---|---|---|---|---|
| **7D (baseline)** | **20.0%** | **0.52** | **−0.39R** | 🔴 CRITICAL |
| **30D (baseline)** | **35.0%** | **1.16** | **+0.10R** | 🟡 MARGINAL |

Breakeven WR at ~2.1:1 median RR = **32.3%**. The 7D baseline is 12.3pp below breakeven.

### Volume & Gates (pre-P0, all OFF)

| Metric | Baseline Value | Source |
|---|---|---|
| Est. signals/week (all modes) | ~50–70 | Extrapolated from mode scan rates |
| high_confidence signals/week | ~9–12 | [P1.INTEL] 9 signals in 7D window |
| Probability gate blocks/week | 0 | Gate was OFF |
| Regime hard gate V2 blocks/week | 0 | Gate was OFF (legacy BUY-in-bear only) |
| Early breakout penalty blocks/week | 0 | Flag was OFF |
| Signals blocked total/week | 0 | No suppression active |
| Telegram delivered % | ~100% | All generated signals sent |

### Live Book at Baseline

Three active signals at audit date [LIVE 2026-06-16]:

| Signal | empirical_wr | empirical_grade | WR≥40 gate result |
|---|---|---|---|
| SOL (HEURISTIC, setup=77) | 27.78% | D | FAIL |
| VIRTUAL (HEURISTIC, setup=100) | 31.21% | B | FAIL |
| Third signal | 40.65% | C | PASS |

Weighted avg empirical_wr of live book: **33.2%** (at breakeven, with downside skew from Grade D).

### Confidence Band Performance at Baseline

| Band | Actual WR | Drift (actual − stated) |
|---|---|---|
| 95–100 | 35.5% | −62pp |
| **90–94** | **31.4%** | **−61pp (worst band)** |
| 85–89 | 42.1% | −45pp |
| 80–84 | ~31% est. | −50pp est. |

### Grade Performance at Baseline

| Grade (heuristic) | WR | Status |
|---|---|---|
| A | 33.9% | 🔴 LOSING — below breakeven |
| B | 36.1% | 🔴 LOSING — below breakeven |
| C | 56.4% | ✅ Best heuristic performer |

| Grade (empirical) | WR | Exp | Status |
|---|---|---|---|
| A+ | 73.5% | +1.286R | ✅ |
| A | 58.0% | +0.829R | ✅ |
| B+ | 44.4% | +0.370R | ✅ |
| B | 41.2% | +0.260R | ✅ |
| D | 13.6% | −0.581R | 🔴 SUPPRESS |

---

## Post-Recovery Targets (P0 Scenario A — flags only)

Source: SIGNAL_QUALITY_AUDIT_3.md §12.

| Metric | Baseline | P0 Target | P1 Target (flags + settings) |
|---|---|---|---|
| 7D WR | 20.0% | **33–38%** | 38–45% |
| 7D Expectancy | −0.39R | **−0.05 to +0.15R** | +0.15 to +0.35R |
| 7D PF | 0.52 | **0.95–1.35** | 1.35–1.85 |
| Signal volume | 100% | **50–60%** | 35–50% |
| Avg empirical_wr (delivered) | ~33% | **>42%** | >45% |

Breakeven crossed at WR = 32.3%. **P0 target minimum is 33%.**

---

## Monitoring Methodology

### Data Sources

| Metric | Primary Source | Fallback |
|---|---|---|
| signals_generated | `SELECT COUNT(*) FROM signals WHERE created_at >= window_start` | — |
| signals_delivered | `SELECT COUNT(*) FROM signals WHERE telegram_delivered = true AND created_at >= window_start` | `telegram_sent = true` |
| probability_gate_blocks | `gate_rejections['probability_send_gate']` accumulated across scans | `signals WHERE telegram_sent = false AND empirical_wr < 40` |
| regime_gate_blocks | `gate_rejections['CONTRA_REGIME_REJECTION']` per scan | — |
| early_breakout_blocks | `gate_rejections['BUY_EARLY_BREAKOUT']` per scan | signals count delta before/after penalty |
| WR (resolved) | `signal_outcomes WHERE resolution_time >= window_start AND outcome != 'PENDING'` | — |
| Expectancy | `AVG(CASE WHEN outcome='TP' THEN rr_achieved ELSE -1.0 END)` | — |
| PF | `SUM(rr_achieved WHERE outcome='TP') / COUNT(WHERE outcome='SL')` | — |
| Avg confidence | `AVG(confidence) FROM signals WHERE created_at >= window_start` | — |
| Avg empirical_wr | `AVG(empirical_wr) FROM signals WHERE created_at >= window_start AND empirical_wr IS NOT NULL` | — |

### Collection Cadence

- **Daily:** Fill daily log (signals generated, delivered, blocked by each gate)
- **Day 7:** First checkpoint — compute 7D WR/PF/Exp; make Continue/Hold/Revert call
- **Day 14:** Full recovery assessment — compare all metrics vs baseline and targets
- **Day 30:** P0 validated; begin P1 consideration (TRENDING/FUTURES min_conf raises)

### Gate Key Mapping (backend/analytics/scan_metrics.py)

| Gate | Key in gate_rejections | Counts when |
|---|---|---|
| Probability gate | `probability_send_gate` | Signal generated, telegram suppressed due to empirical_wr < min_empirical_wr |
| Regime hard gate V2 | `CONTRA_REGIME_REJECTION` | BUY in BEAR/CAPITULATION OR SELL in BULL/EUPHORIA without HIGH_MOMENTUM override |
| Early breakout penalty | `BUY_EARLY_BREAKOUT` | BUY + EARLY_BREAKOUT signal, setup_score reduced by −8 (if below pipeline threshold) |
| NULL regime (pre-existing) | `REGIME_REJECTION` | Signal has no BTC regime detected (ALPHA.TRUTH.1 gate) |
| Duplicate signal | `DUPLICATE_SIGNAL` | Cooldown active for symbol+direction |

---

## Daily Log Template

Fill each row at end of day. `—` = not yet resolved (outcomes lag by hours).

```
DATE: ________ | BTC Regime: ________ | Mode mix: spot/futures/trending

GENERATION
  Coins scanned:           ___
  Pipeline rejections:
    - CONTRA_REGIME:       ___   (regime V2 gate)
    - BUY_EARLY_BREAKOUT:  ___   (breakout penalty)
    - CONFIDENCE_REJECT:   ___
    - NULL_REGIME:         ___
    - Other:               ___
  Signals generated:       ___   (reached signals table)

DELIVERY
  Probability gate blocks: ___   (generated but NOT delivered; empirical_wr < 40)
  Signals delivered:       ___   (Telegram sent)
  Delivery rate:           ___%  (delivered / generated)

QUALITY
  Avg empirical_wr (delivered):  ___%
  Avg empirical_wr (blocked):    ___%
  Any OI_NEUTRAL blocked?        Y/N
  Any Grade A+ blocked?          Y/N

OUTCOMES (if any resolved)
  Resolved today:          ___
  TP:                      ___
  SL:                      ___
  Daily WR:                ___%
```

---

## 1. Volume Impact

### Before vs After

| Metric | Before (baseline) | P0 Target | Actual (fill in) |
|---|---|---|---|
| Signals generated/week | ~50–70 | ~40–55 (−15–25% from mode disable) | — |
| Probability gate blocks/week | 0 | ~20–30 (40–50% of generated) | — |
| Regime gate blocks/week | 0 (V1 only) | ~5–10 (10–15% of scanned) | — |
| Early breakout blocks/week | 0 | ~3–7 (8–12% of BUY signals) | — |
| Signals delivered/week | ~50–70 | **~15–27** | — |
| high_confidence signals/week | ~9–12 | **0** | — |
| Telegram delivery rate | ~100% | ~45–60% | — |

### Thresholds

| Condition | Assessment |
|---|---|
| Delivered < 5/week | 🔴 OVER-FILTERING — probability gate may be blocking good cohorts |
| Delivered 5–15/week | 🟡 TIGHT — acceptable if avg empirical_wr > 45% |
| Delivered 15–30/week | ✅ ON TARGET |
| Probability gate blocks 0/week | 🟡 GATE NOT FIRING — check min_empirical_wr setting |
| Regime gate blocks 0/week after 3 days | 🟡 BTC REGIME MAY BE BULL — expected if no contra-regime signals |

### What Volume Reduction Means

The volume drop is **intentional**. Pre-recovery, 100% volume delivery with 20% WR = expected −0.39R per signal. Post-recovery, 45% volume delivery with 35%+ WR = expected ≥ 0R per signal. Every blocked signal that would have lost money is a win.

---

## 2. Win Rate Impact

### Before vs After

| Window | Before | P0 Target | Actual Day 7 | Actual Day 14 |
|---|---|---|---|---|
| 7D WR | 20.0% | **33–38%** | — | — |
| 30D WR | 35.0% | 37–42% (30D lags 7D by ~3 weeks) | — | — |
| Breakeven WR | 32.3% | 32.3% (unchanged) | — | — |
| Margin above breakeven | −12.3pp | +0.7 to +5.7pp | — | — |

### Expected Recovery Path

The 7D WR recovery is not instantaneous. The pre-P0 signals that were delivered before the flags were applied will continue resolving in the first 1–3 days and will dilute the 7D WR. Clean P0 data only begins on the first signal delivered after flags were applied.

| Day | Expected 7D WR | Notes |
|---|---|---|
| Day 1–3 | ~20–27% | Pre-P0 signals still resolving in the 7D window |
| Day 4–5 | ~27–32% | Mix improving as P0 signals accumulate |
| Day 6–7 | ~30–38% | First clean 7D window with majority P0 signals |
| Day 14 | ~35–42% | Full 14D window of P0 signals |

### Thresholds at Day 7

| 7D WR | Assessment |
|---|---|
| < 25% | 🔴 CRITICAL — gates not working or pre-P0 tail too heavy |
| 25–32% | 🟡 TRANSITIONING — recovery in progress |
| 33–38% | ✅ ON TARGET (P0 Scenario A) |
| > 38% | ✅✅ AHEAD — consider accelerating P1 |

### Confidence Band Watch

The 90–94 band was the worst performer (31.4% WR) due to intelligence-boost inflation of borderline signals. Post-P0, the probability gate should suppress signals whose cohort WR is below 40%, which will remove most of these.

Watch for signals in the 90–94 confidence range. If any are still being delivered, check their empirical_wr stamp. Delivering a 90–94 confidence signal with empirical_wr 27% is the exact failure mode from the pre-recovery book.

---

## 3. Expectancy Impact

### Before vs After

| Window | Before | P0 Target | Actual Day 7 | Actual Day 14 |
|---|---|---|---|---|
| 7D Expectancy | −0.39R | **−0.05 to +0.15R** | — | — |
| 30D Expectancy | +0.10R | +0.12 to +0.25R (lagged) | — | — |
| Per-signal cost (pre-P0) | −0.39R/signal | Target: ≥ 0R | — | — |

### Expectancy Decomposition

Expectancy = WR × avg_win_R − (1 − WR) × avg_loss_R

At 2.1:1 avg RR:
- Pre-P0: 0.20 × 2.1 − 0.80 × 1.0 = 0.42 − 0.80 = **−0.38R** ✓ consistent with baseline
- P0 target (WR=36%): 0.36 × 2.1 − 0.64 × 1.0 = 0.756 − 0.64 = **+0.116R** ✓ matches target

### Thresholds

| 7D Expectancy | Assessment |
|---|---|
| < −0.20R | 🔴 REVERT — P0 not working |
| −0.20 to 0R | 🟡 TRANSITIONING (acceptable for first 5 days) |
| 0 to +0.15R | ✅ P0 ON TARGET |
| > +0.15R | ✅✅ AHEAD OF TARGET — consider P1 |

### Watch: Avg RR Drift

If the probability gate is systematically blocking high-RR signals (possible if HIGH_MOMENTUM signals have low empirical_wr stamps from a SIDEWAYS-dominant attribution window), avg RR may drop. Target: avg RR ≥ 1.8:1. If avg RR drops below 1.8, breakeven WR rises above 35.7%, and the 33–38% target becomes insufficient.

---

## 4. PF Impact

### Before vs After

| Window | Before | P0 Target | Actual Day 7 | Actual Day 14 |
|---|---|---|---|---|
| 7D PF | 0.52 | **0.95–1.35** | — | — |
| 30D PF | 1.16 | 1.20–1.50 | — | — |

PF < 1.0 = losing system. PF > 1.5 = strong positive edge. PF = 1.0 = breakeven.

### PF by Cohort Targets

Post-P0, the delivered signal mix should shift toward:
- Grade A/A+ empirical (PF 3.0–5.85) — highest PF cohorts
- OI_NEUTRAL futures (PF ~7.0) — best documented cohort
- CONFIRMED_BREAKOUT + regime-aligned (PF 2.2–2.5)

And away from:
- Grade D empirical (PF 0.33) — blocked by probability gate
- high_confidence mode signals (PF 0.00 in last 7D) — mode disabled
- Contra-regime BUY without override (PF ~0.47) — blocked by regime V2

### Thresholds

| 7D PF | Assessment |
|---|---|
| < 0.75 | 🔴 REVERT — worse than marginal |
| 0.75–1.00 | 🟡 BELOW BREAKEVEN — transitioning |
| 1.00–1.35 | ✅ P0 ON TARGET |
| > 1.35 | ✅✅ AHEAD — P1 ready |

---

## 5. Best Performing Cohorts

These cohorts should INCREASE in share post-P0 as low-quality signals are filtered. Monitor for their presence in the delivered signal feed.

### Top Cohorts to Watch

| Cohort | Expected WR | Expected Exp | Gate Treatment | Watch Metric |
|---|---|---|---|---|
| OI_NEUTRAL (futures) | 76.3% | +1.776R | Should PASS all gates (WR >> 40%) | Count per week; any blocked? |
| Grade A+ empirical | 73.5% | +1.286R | Should PASS (WR 73.5% >> 40%) | Fraction of delivered signals |
| HIGH_MOMENTUM override (regime gate) | 81.8% | ~+1.5R | PASS via regime override even in contra-regime | Count of CONTRA_REGIME signals that used override |
| BEAR\|SELL\|HIGH_MOMENTUM | 81.8% | ~+1.5R | Should PASS all gates | Weekly count |
| BEAR\|SELL\|EARLY | 68.0% | +0.8R est. | Should PASS | Weekly count |
| Confirmed breakout + aligned regime | ~55–65% | +0.6–0.9R | Should PASS | Fraction of delivered |
| 85–89 band + regime-known | 57.6% | +0.55R est. | Should PASS | Confidence band distribution |

### Confirmation Signal

If OI_NEUTRAL signals are appearing in the delivered feed at their historical 76.3% rate, the pipeline is working correctly. If OI_NEUTRAL signals are being blocked (empirical_wr stamp < 40%), the attribution_snapshots have insufficient OI_NEUTRAL data at n≥30 — this is a false negative requiring investigation.

---

## 6. Worst Performing Cohorts

These cohorts should be ABSENT or significantly reduced post-P0. Their presence is a signal that a gate is not firing correctly.

### Cohorts That Should Be Blocked Post-P0

| Cohort | Pre-P0 WR | Gate That Should Block | Check If Present |
|---|---|---|---|
| Grade D empirical (empirical_wr ~14%) | 13.6% | Probability gate (WR < 40%) | Any Grade D signals delivered? |
| Contra-regime BUY, no HIGH_MOMENTUM | 19% | Regime hard gate V2 | CONTRA_REGIME count in gate_rejections |
| high_confidence mode signals | 0% (7D) | Mode disabled entirely | 0 signals from high_confidence mode |
| Confidence 90–94 with empirical_wr < 40% | 31.4% | Probability gate | Confidence band distribution of delivered |
| BUY + EARLY_BREAKOUT (near-threshold) | ~33–38% est. | Early breakout penalty | BUY_EARLY_BREAKOUT count |
| Heuristic Grade A (inverted: 33.9% WR) | 33.9% | Probability gate + riskgrade_v2 | Check that these now show as empirical grade |

### Residual Risk Cohorts (Not Blocked by P0 — Watch)

These are still flowing through post-P0 and may continue to underperform:

| Cohort | WR | Why Not Blocked | Monitor |
|---|---|---|---|
| SIDEWAYS + BUY (any breakout) | ~30–35% est. | No SIDEWAYS hard gate | If BTC is in SIDEWAYS, watch for BUY losses |
| TRENDING 78–84 confidence band | ~30–35% est. | P1 fix only (settings change) | Will not be addressed until P1 |
| FUTURES 82–84 confidence band | ~33–37% est. | P1 fix only | Same |
| Confidence 90–94 with empirical_wr > 40% | 31.4% global | Probability gate might PASS | Check: any 90–94 signals have empirical_wr 40–43%? |

---

## 7. Gate Effectiveness

For each gate, define what "working" looks like and what "not working" looks like.

### Gate 1: Probability Gate (`probability_gate_v1`, WR≥40)

| Metric | Working | Not Working |
|---|---|---|
| Weekly blocks | 15–35 | < 5 or > 50 |
| Avg empirical_wr of blocked signals | < 35% | > 45% (blocking good cohorts) |
| Avg empirical_wr of delivered signals | > 42% | < 38% (gate not filtering enough) |
| OI_NEUTRAL blocked | Never | Any time (false negative alert) |
| Grade D delivered | Never | Any time (gate failure alert) |

**What Not Working Looks Like:**
- Blocks = 0: `min_empirical_wr` setting not saved, or empirical_wr stamps are NULL for all signals (migration not run)
- Avg blocked WR > 45%: cohort WR stamps in attribution_snapshots are stale/incorrect for current regime
- Grade D signals delivered: empirical_grade stamping not running, or gate bypass

**Root Cause if Blocking 0:**
Check `signal.empirical_wr IS NULL` count. If NULL, `probability-gate-migration.sql` was not run or the nightly stamp job is failing. The gate cannot fire without a valid empirical_wr stamp.

---

### Gate 2: Regime Hard Gate V2 (`regime_hard_gate_v2`)

| Metric | Working | Not Working |
|---|---|---|
| CONTRA_REGIME_REJECTION count | Varies with BTC regime | Always 0 |
| HIGH_MOMENTUM overrides | Present when BTC is in BEAR | 0 even during BEAR regime |
| CONTRA_REGIME blocked WR (historical) | ~19% | Would need spot-check |
| Delivered contra-regime signals | Only HIGH_MOMENTUM | Any non-HIGH_MOMENTUM contra-regime |

**When 0 Blocks Is Normal:**
If BTC is in BULL_TREND and the system is generating BUY signals, there will be no contra-regime BUY signals. 0 blocks in BULL_TREND is correct behavior.

**When 0 Blocks Is a Problem:**
If BTC is in BEAR_TREND and 0 CONTRA_REGIME_REJECTION blocks are counted, the gate is not firing. Check `features.regime_hard_gate_v2` is still ON (not reverted by a settings reset).

**Override Quality:**
The HIGH_MOMENTUM override cohort WR = 81.8%. Every signal that uses the override should be tracked. If override signals are losing (< 50% WR over 7+ signals), the override criteria may need review.

---

### Gate 3: Early Breakout Penalty (`early_breakout_penalty_v1`)

| Metric | Working | Not Working |
|---|---|---|
| BUY_EARLY_BREAKOUT suppressions/week | 3–8 | 0 |
| SELL+EARLY_BREAKOUT unaffected | Still delivered (68% WR, alpha) | SELL+EARLY blocked (flag regression) |
| BUY+EARLY_BREAKOUT in delivered feed | Near zero | Any present |

**Note on SELL+EARLY:**
SELL+EARLY_BREAKOUT has **68% WR** — it is alpha. The penalty only applies to BUY side. Confirm in `early_breakout_score_adj()` that SELL signals return 0 adjustment. If SELL+EARLY signals are disappearing post-P0, it is a gate regression.

---

### Gate 4: high_confidence Mode Disable

| Metric | Working | Not Working |
|---|---|---|
| high_confidence signals this week | 0 | > 0 |
| Mode in scheduler beat | Not listed | Listed |

This gate is binary. If `high_confidence_mode_enabled = false`, the scheduler skips this mode entirely. No signals from it. Confirmation: check `scan_metrics_log` for mode column — `high_confidence` should be absent from all scans post-P0.

---

## 8. False Negative Analysis

False negatives = high-quality signals blocked by the new gates that should have been allowed through.

### False Negative Risk Categories

**Risk FN-1: Probability gate blocking good cohorts due to stale attribution_snapshots**

Scenario: BTC shifted from BEAR_TREND → SIDEWAYS 7 days ago. Attribution_snapshots are 30D-dominant and reflect BEAR_TREND cohort data. A new SIDEWAYS|BUY|HIGH_MOMENTUM signal may have its empirical_wr stamped from a BEAR|BUY cohort (different lookup level), which has WR=27% → blocked.

Detection: Check if blocked signals have `empirical_wr` stamps that don't match their `market_regime`. Query:
```sql
SELECT s.symbol, s.market_regime, s.empirical_wr, s.breakout_strength
FROM signals s
WHERE s.created_at >= '2026-06-16'
  AND s.telegram_sent = false  -- blocked by prob gate
  AND s.empirical_wr < 40
  AND s.breakout_strength = 'HIGH_MOMENTUM_BREAKOUT'
```
If HIGH_MOMENTUM signals are being blocked, this is FN-1. Check attribution_snapshots for `HIGH_MOMENTUM` row count per regime.

---

**Risk FN-2: OI_NEUTRAL signals blocked**

OI_NEUTRAL historical WR = 76.3% (N=38). Its empirical_wr stamp should reflect ~76% → PASS at WR≥40.

However: if the attribution_snapshots row for `oi_interpretation=OI_NEUTRAL` has n < 30, the lookup falls back to the next level. If the fallback cohort has WR < 40%, the signal is blocked despite being in the best documented futures cohort.

Detection:
```sql
SELECT symbol, empirical_wr, oi_interpretation, created_at
FROM signals
WHERE created_at >= '2026-06-16'
  AND oi_interpretation = 'OI_NEUTRAL'
  AND telegram_sent = false
```
Any OI_NEUTRAL signal in this result is a confirmed false negative. Log immediately and investigate the attribution_snapshots n for `OI_NEUTRAL` rows.

---

**Risk FN-3: Grade A+ empirical blocked**

Grade A+ WR = 73.5%. Should always PASS WR≥40. If any Grade A+ empirical signal is blocked, the empirical_grade ↔ empirical_wr mismatch indicates the probability gate is using the wrong lookup level.

Detection:
```sql
SELECT symbol, empirical_grade, empirical_wr
FROM signals
WHERE created_at >= '2026-06-16'
  AND empirical_grade IN ('A+', 'A')
  AND telegram_sent = false
```
Expected result: empty. Any rows = FN-3 critical.

---

**Risk FN-4: TRENDING mode near-miss false negatives**

Trending mode's min_confidence is still 78 (P1 fix pending). Trending signals with confidence 78–84 will continue to be generated, and if their empirical_wr stamps reflect TRENDING mode cohorts (which include the poor 78–84 signals), they may be blocked at WR≥40.

This is **acceptable behavior** — the probability gate is correctly suppressing the TRENDING 78–84 signals that SIGNAL_QUALITY_AUDIT_3.md identified as having negative expectancy. These are true positives, not false negatives.

The false negative concern is a trending signal with confidence ≥85 that gets its empirical_wr from the broader TRENDING cohort (which includes the 78–84 tail) rather than the ≥85 subset. Watch:
```sql
SELECT confidence, empirical_wr, telegram_sent
FROM signals
WHERE mode = 'trending' AND confidence >= 85
  AND created_at >= '2026-06-16'
```
If ≥85 trending signals are being blocked, the probability gate is using the full TRENDING cohort WR (dragged down by 78–84) rather than the ≥85 subset. This would be a precision gap to address in P1.

---

### False Negative Severity Matrix

| False Negative Type | Severity | Action |
|---|---|---|
| OI_NEUTRAL blocked | 🔴 CRITICAL | Investigate attribution n immediately |
| Grade A+/A empirical blocked | 🔴 CRITICAL | Check empirical_grade stamping pipeline |
| HIGH_MOMENTUM blocked by regime gate | 🔴 HIGH | Check override logic in `contra_regime_gate()` |
| SELL+EARLY_BREAKOUT blocked | 🔴 HIGH | Flag regression — check `early_breakout_score_adj()` |
| CONFIRMED_BREAKOUT + aligned regime blocked | 🟡 MEDIUM | Attribution data review |
| High-confidence (≥87) signal blocked | 🟡 MEDIUM | Check empirical_wr of the 85–89 lookup level |
| Trending ≥85 confidence blocked | 🟢 LOW | Acceptable until P1 fixes attribution precision |

---

## 9. Recovery Score

A composite 0–10 score measuring progress from the pre-recovery baseline toward the P0 target. Computed at each checkpoint (Day 7, Day 14, Day 30).

### Formula

```
Recovery Score (0–10) =
  0.30 × WR_Score
  + 0.30 × Exp_Score
  + 0.20 × PF_Score
  + 0.10 × Gate_Score
  + 0.10 × VolumeQuality_Score
```

### Component Calculations

**WR_Score (0–10):**
```
WR_Score = CLAMP(0, 10, (WR_7D − 0.20) / (0.40 − 0.20) × 10)
```
Baseline anchor: 20% = 0 points. Healthy target: 40% = 10 points.

| 7D WR | WR_Score |
|---|---|
| 20% | 0.0 |
| 25% | 2.5 |
| 30% | 5.0 |
| 35% | 7.5 |
| 40% | 10.0 |

---

**Exp_Score (0–10):**
```
Exp_Score = CLAMP(0, 10, (Exp_7D + 0.39) / (0.35 + 0.39) × 10)
```
Baseline anchor: −0.39R = 0 points. Healthy target: +0.35R = 10 points.

| 7D Exp | Exp_Score |
|---|---|
| −0.39R | 0.0 |
| −0.20R | 2.6 |
| 0.00R | 5.3 |
| +0.15R | 7.3 |
| +0.35R | 10.0 |

---

**PF_Score (0–10):**
```
PF_Score = CLAMP(0, 10, (PF_7D − 0.52) / (1.85 − 0.52) × 10)
```
Baseline anchor: 0.52 = 0 points. Healthy target: 1.85 = 10 points.

| 7D PF | PF_Score |
|---|---|
| 0.52 | 0.0 |
| 0.80 | 2.1 |
| 1.00 | 3.6 |
| 1.35 | 6.2 |
| 1.85 | 10.0 |

---

**Gate_Score (0–10):**
Measures gate quality: are blocks coming from the right cohorts?

```
Gate_Score = 5 × (avg_empirical_wr_blocked < 0.38)
           + 5 × (avg_empirical_wr_delivered > 0.42)
```
Binary: 5 points each condition, 10 if both met, 0 if neither.

---

**VolumeQuality_Score (0–10):**
```
VQ_Score = CLAMP(0, 10, (avg_empirical_wr_delivered − 0.33) / (0.55 − 0.33) × 10)
```
Baseline: 33% (breakeven) = 0 points. Target: 55% = 10 points.

| Avg empirical_wr (delivered) | VQ_Score |
|---|---|
| 33% | 0.0 |
| 38% | 2.3 |
| 42% | 4.1 |
| 48% | 6.8 |
| 55% | 10.0 |

---

### Reference Scores

| Scenario | Recovery Score | Interpretation |
|---|---|---|
| Baseline (pre-P0) | ~0.5 | Starting point |
| P0 Transition (Day 3–5) | ~3.0–4.5 | Expected during signal mix transition |
| P0 Target (Scenario A) | **~6.5–7.5** | Target at Day 7 |
| P1 Deployed | ~8.0–9.0 | After TRENDING/FUTURES floor raises |
| Full recovery (Scenario C) | ~9.0–9.5 | WR~50%, Exp ~+0.45R |

### Day 7 Score Calculation Template

```
WR_7D:        ____%    → WR_Score:  ___/10
Exp_7D:       ____R    → Exp_Score: ___/10
PF_7D:        ____     → PF_Score:  ___/10
Gate_Score:   ___/10   (blocked WR < 38%? Y/N · delivered WR > 42%? Y/N)
VQ_Score:     ___/10   (avg empirical_wr delivered: ___%)

Recovery Score = 0.30×___ + 0.30×___ + 0.20×___ + 0.10×___ + 0.10×___
              = _____
```

---

## 10. Continue / Revert Recommendation

### Decision Framework (Day 7 Checkpoint — 2026-06-23)

**Decision Input:** Recovery Score (Section 9) + gate effectiveness checks + false negative analysis

---

**CONTINUE → P1 IMPLEMENTATION** ✅
```
Condition:
  Recovery Score ≥ 7.0
  AND 7D WR ≥ 33%
  AND No critical false negatives (OI_NEUTRAL / Grade A+ not blocked)
  AND Avg empirical_wr of delivered signals > 40%

Action:
  Proceed with P1 fixes (STEP 3 from SIGNAL_QUALITY_AUDIT_3.md §15)
  - TRENDING min_confidence: 78 → 85 (signal_pipeline.py CONFIGS)
  - FUTURES min_confidence: 82 → 85 (signal_pipeline.py CONFIGS)
  Target Day 14: 7D WR 38–45%, Exp +0.15 to +0.35R
```

---

**HOLD — MONITOR ANOTHER 7 DAYS** 🟡
```
Condition:
  Recovery Score 5.0–6.9
  AND 7D WR 28–33% (transitioning but not there yet)
  AND No critical false negatives

Action:
  Do not deploy P1. Continue monitoring.
  Investigate which component of Recovery Score is lagging.
  If WR_Score < 5.0: check if pre-P0 signal tail is still in the 7D window
  If Gate_Score < 5.0: investigate attribution_snapshots row counts
  If VQ_Score < 4.0: check probability gate is actually firing
  Re-assess at Day 14 with same decision framework.
```

---

**PARTIAL REVERT** 🟠
```
Condition:
  Recovery Score 3.0–4.9
  AND (7D WR < 28% OR delivered < 5 signals/week)

Likely cause:
  Over-filtering: probability gate is blocking too many signals.
  Possible: attribution_snapshots have insufficient n≥30 rows in current regime.

Action:
  Option A: Raise min_empirical_wr threshold DOWN to 35 (from 40)
    - Re-test: signals blocked count, avg empirical_wr of blocked signals
  Option B: Investigate attribution_snapshots coverage
    - Run: SELECT dim_key, COUNT(*), AVG(empirical_wr) FROM attribution_snapshots
            WHERE dim_key LIKE '%HIGH_MOMENTUM%' AND window_days = 30
    - If n < 30 for most HIGH_MOMENTUM cells, gate is under-informed
  Option C: Keep P0 but add min_empirical_n = 30 guard
    - Only gate when empirical_n >= 30 (already in probability.py: unknown prob = NEVER gates)
    - Verify: is the NEVER-gates behavior working for NULL empirical_wr signals?
  Do NOT revert regime_hard_gate_v2 (data basis N=200 is sufficient, not attribution-dependent)
  Do NOT revert early_breakout_penalty (pure setup score math, attribution-independent)
  Do NOT re-enable high_confidence mode (0/9 wins is unambiguous)
```

---

**FULL REVERT** 🔴
```
Condition:
  Recovery Score < 3.0 after Day 7
  OR 7D WR < 25% with WR declining (not transitioning upward)
  OR Critical false negative confirmed (OI_NEUTRAL blocked, Grade A+ blocked)

Action:
  Disable probability_gate_v1 (set FALSE)
  Keep: regime_hard_gate_v2 ON (data-backed, attribution-independent)
  Keep: early_breakout_penalty_v1 ON (setup score math, no calibration needed)
  Keep: high_confidence mode OFF (0/9 wins)
  Keep: riskgrade_v2 ON (display-only, zero trading impact)

  Investigate:
    1. Check attribution_snapshots nightly job ran: GET /api/analytics/attribution-snapshots
    2. Check empirical_wr is being stamped on signals
    3. Check probability-gate-migration.sql was run in Supabase
    4. Check signal-outcomes-regime-migration.sql was run (required for performance_verification.py)

  Re-enable probability_gate at lower threshold (WR≥35) after investigation
```

---

### Summary Decision Table

| Recovery Score | 7D WR | Action |
|---|---|---|
| ≥ 7.0 | ≥ 33% | ✅ **CONTINUE → P1** |
| 5.0–6.9 | 28–33% | 🟡 **HOLD 7 more days** |
| 5.0–6.9 | ≥ 33% | ✅ **CONTINUE — score catching up** |
| 3.0–4.9 | < 28% | 🟠 **PARTIAL REVERT — lower gate threshold** |
| < 3.0 | < 25% | 🔴 **FULL REVERT — investigate attribution** |
| Any | OI_NEUTRAL blocked | 🔴 **FALSE NEGATIVE — investigate immediately** |

---

## Appendix A: Pending Database Migrations

Before the probability gate can fire reliably, confirm these migrations have been run in Supabase SQL Editor:

| Migration | Required For | Status |
|---|---|---|
| `database/probability-gate-migration.sql` | `empirical_wr` / `empirical_n` columns on `signals` | Confirm |
| `database/probability-engine-migration.sql` | `empirical_grade` column on `signals` | Confirm |
| `database/signal-outcomes-regime-migration.sql` | `market_regime` on `signal_outcomes` (required by performance_verification.py) | Confirm |
| `database/attribution-snapshots-migration.sql` | `attribution_snapshots` table (required for cohort WR lookups) | Confirm |
| `database/telegram-delivery-migration.sql` | `telegram_delivered` / `telegram_delivery_error` tracking | Confirm |
| `database/validation-source-migration.sql` | `validation_source` column on `signals` | Confirm |

If `attribution_snapshots` table does not exist, the probability gate will not have cohort data. The gate behavior in this case is `unknown probability → NEVER gates` (fail-open), meaning the gate effectively does nothing.

---

## Appendix B: Key Monitoring Queries

### Daily Signal Summary
```sql
SELECT
  DATE(created_at) as day,
  COUNT(*) as generated,
  COUNT(*) FILTER (WHERE telegram_delivered = true) as delivered,
  COUNT(*) FILTER (WHERE telegram_sent = false OR telegram_delivered = false) as blocked,
  ROUND(AVG(empirical_wr) FILTER (WHERE telegram_delivered = true), 3) as avg_wr_delivered,
  ROUND(AVG(empirical_wr) FILTER (WHERE telegram_sent = false), 3) as avg_wr_blocked,
  ROUND(AVG(confidence), 1) as avg_confidence,
  COUNT(*) FILTER (WHERE empirical_grade = 'D') as grade_d_count
FROM signals
WHERE created_at >= '2026-06-16'
GROUP BY 1
ORDER BY 1;
```

### 7D Performance
```sql
SELECT
  COUNT(*) FILTER (WHERE outcome = 'TP') as tp,
  COUNT(*) FILTER (WHERE outcome = 'SL') as sl,
  ROUND(COUNT(*) FILTER (WHERE outcome = 'TP')::numeric / NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP','SL')), 0), 3) as wr,
  ROUND(AVG(CASE WHEN outcome = 'TP' THEN rr_achieved ELSE -1.0 END), 3) as expectancy
FROM signal_outcomes
WHERE resolution_time >= NOW() - INTERVAL '7 days'
  AND outcome IN ('TP', 'SL');
```

### Gate Effectiveness Check
```sql
SELECT
  CASE WHEN telegram_delivered = true THEN 'delivered' ELSE 'blocked' END as bucket,
  COUNT(*) as n,
  ROUND(AVG(empirical_wr), 3) as avg_empirical_wr,
  ROUND(AVG(confidence), 1) as avg_confidence,
  COUNT(*) FILTER (WHERE empirical_grade = 'D') as grade_d,
  COUNT(*) FILTER (WHERE empirical_grade IN ('A+','A')) as grade_a_plus
FROM signals
WHERE created_at >= '2026-06-16'
  AND empirical_wr IS NOT NULL
GROUP BY 1;
```

### False Negative Check (OI_NEUTRAL blocked)
```sql
SELECT symbol, created_at, empirical_wr, empirical_grade, oi_interpretation, market_regime
FROM signals
WHERE created_at >= '2026-06-16'
  AND oi_interpretation = 'OI_NEUTRAL'
  AND (telegram_sent = false OR telegram_delivered = false)
ORDER BY created_at DESC;
-- Expected: 0 rows. Any rows = false negative alert.
```

### Attribution Coverage Check
```sql
SELECT
  dim_key,
  SUM(n_signals) as total_n,
  ROUND(AVG(win_rate), 3) as avg_wr
FROM attribution_snapshots
WHERE dim_key LIKE '%HIGH_MOMENTUM%'
  AND window_days = 30
  AND generated_at = (SELECT MAX(generated_at) FROM attribution_snapshots)
GROUP BY dim_key
ORDER BY total_n DESC;
-- Verify: n >= 30 for top regime|type|breakout combos. n < 30 = gate will fall back one level.
```

---

## Appendix C: Recovery Timeline Reference

```
2026-06-16 (Day 0)  : P0 flags applied. Baseline locked.
2026-06-17 (Day 1)  : First P0 signals appear. Pre-P0 signals still resolving.
2026-06-18 (Day 2)  : Check: are gates firing? (gate_rejections in scan logs)
2026-06-19 (Day 3)  : First meaningful daily log. WR will still be contaminated.
2026-06-20 (Day 4)  : Check probability gate avg empirical_wr of blocked vs delivered.
2026-06-21 (Day 5)  : False negative scan: any OI_NEUTRAL or Grade A+ blocked?
2026-06-22 (Day 6)  : Pre-compute Recovery Score components.
2026-06-23 (Day 7)  : CHECKPOINT — compute Recovery Score — Continue/Hold/Revert decision.
2026-06-30 (Day 14) : Full 14D window clean. P1 decision window.
2026-07-16 (Day 30) : 30D window fully P0-clean. Full P0 validation.
```

---

*Generated: 2026-06-16*  
*Source documents: SIGNAL_QUALITY_AUDIT_3.md · PERFORMANCE_VERIFICATION_1.md · CONFIDENCE_CALIBRATION_2.md*  
*Next review: 2026-06-23 (Day 7 Checkpoint)*  
*No code changes. No scanner modifications. No confidence logic changes. Monitoring only.*
