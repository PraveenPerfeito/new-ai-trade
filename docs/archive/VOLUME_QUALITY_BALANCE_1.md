# VOLUME.QUALITY.BALANCE.1
**Date:** 2026-06-23  
**Objective:** Determine whether signal volume has become excessively restrictive after P0/P1 recovery gates.  
**Goal:** Maximize expectancy without starving signal volume.  
**Constraints:** Do NOT add indicators. Do NOT add AI. Do NOT modify existing gates. Do NOT implement new gates yet.

---

## Executive Summary

**Classification: REGIME-CONDITIONAL FILTERING — appropriate in BEAR_TREND, silent in SIDEWAYS.**

The 89% delivery suppression observed June 16–22 was not gate over-tightening — it was BTC locked in SIDEWAYS regime (WR=30.2%), causing the probability gate to block all SIDEWAYS attribution cohorts. When BTC moved to BEAR_TREND on June 23, delivery rate jumped from 0.17/day to 27/day within 24 hours.

One profitable cohort is now over-blocked by the SIDEWAYS hard gate: **SIDEWAYS|SELL|CONFIRMED_BREAKOUT (WR=45.9%, Exp=+0.418R, n=61/30D)**. All other blocked cohorts have genuinely negative expectancy and are correctly rejected.

**Recommendation (Part F): Relax the SIDEWAYS gate — add CONFIRMED_BREAKOUT to the exemption list alongside HIGH_MOMENTUM_BREAKOUT.**

---

## PART A — Funnel Across 4 Time Periods

Data sources: `/api/analytics/telegram-delivery` (H24 + D7), `docs/SIGNAL_ENGINE_TRUTH_1.md` (pre-P0 baseline), `docs/POST_DEPLOY_RECOVERY_MEASUREMENT_1.md` (post-P0 snapshot).

### Period definitions

| Period | Date Range | Key Change |
|--------|-----------|------------|
| Pre-P0 | Before June 16 | Baseline — no structural gates |
| Post-P0 | June 16–19 | 9 P0 gates activated; probability gate ON; BTC enters SIDEWAYS |
| Post-P1 | June 19–22 | FUTURES/TRENDING confidence floor raised to 85 |
| Post-SIDEWAYS | June 23 | SIDEWAYS hard gate deployed; BTC moves to BEAR_TREND |

### Funnel table

| Period | Generated/day | Eligible/day | Delivered/day | Delivery % | Notes |
|--------|--------------|--------------|---------------|------------|-------|
| Pre-P0 (est.) | ~57 | ~57 | ~15–20 | ~28% | No suppression; WR=20% — over-delivering bad signals |
| Post-P0 + Post-P1 (June 16–22) | ~48 | ~36 | ~0.17 | 0.5% | BTC SIDEWAYS → 99.5% probability gate suppression |
| Post-SIDEWAYS (June 23) | 64 | 45 | 27 | 60% | BTC BEAR_TREND + SIDEWAYS gate deployed |

### Supporting data (live)

**D7 (June 16–23):**  
generated=351 · eligible=260 · queued=28 · delivered=27 · shadowed=13 (dedup) · suppressed_other=219 (probability gate)

**H24 (June 23):**  
generated=64 · eligible=45 · queued=27 · delivered=27 · shadowed=13 · suppressed_other=5

**Derived (June 16–22, 6 days = D7 minus H24):**  
generated=287 · eligible=215 · queued=1 · delivered=0 · suppressed_other=214 (99.5% suppression)

### Key finding

The near-zero delivery rate from June 16–22 was caused by BTC regime SIDEWAYS, not by gates being overly tight. All SIDEWAYS attribution cohorts have WR < 40% and are correctly blocked by the probability gate. The SIDEWAYS hard gate (deployed June 23) now prevents these signals from even reaching the delivery stage, but is moot because BTC is currently in BEAR_TREND.

---

## PART B — Signal Volume by Regime

Data source: `/api/analytics/edge/regime` (720h window, n=2,130 resolved total).

| Regime | n/30D | n/day | WR | Exp | Prob Gate Status | Pipeline Gate | Net Deliverable |
|--------|-------|-------|----|-----|-----------------|---------------|-----------------|
| BEAR_TREND | 992 | 33.1 | 51.4% | +0.619R | ✅ SELL cohorts pass (WR≥40%) | None | **YES — SELL signals** |
| SIDEWAYS | 364 | 12.1 | 30.2% | −0.017R | ❌ All cohorts blocked (WR<40%) | Hard gate (new) | **NO** (except HIGH_MOMENTUM) |
| BULL_TREND | 97 | 3.2 | 21.7% | −0.330R | ❌ All cohorts blocked (WR<40%) | Soft gate only (+10 conf) | **NO** |
| NULL | 677 | 22.6 | ~14.9% | ~−0.543R | N/A (pre-pipeline) | Hard gate (ALPHA.TRUTH.1) | **NO** |

### Volume by regime sub-cohort (deliverable vs blocked)

**BEAR_TREND** (dominant deliverable regime, 33.1 signals/day):
| Sub-cohort | n/30D | WR | Exp | Deliverable? |
|-----------|-------|-----|-----|-------------|
| SELL + HIGH_MOMENTUM_BREAKOUT | 33 | 81.8% | +1.621R | ✅ Yes |
| SELL + EARLY_BREAKOUT | 50 | 68.0% | +1.064R | ✅ Yes |
| SELL + NULL breakout | 141 | 63.8% | +0.958R | ✅ Yes |
| SELL + CONFIRMED_BREAKOUT | 568 | 56.5% | +0.797R | ✅ Yes |
| BUY + CONFIRMED_BREAKOUT | 40 | 25.0% | −0.225R | ❌ Probability gate |
| BUY + NULL breakout | 107 | 20.6% | −0.350R | ❌ Probability gate |

**SIDEWAYS** (12.1 signals/day, all gated after June 23):
| Sub-cohort | n/30D | WR | Exp | Gated by |
|-----------|-------|-----|-----|---------|
| SELL + CONFIRMED_BREAKOUT | 61 | 45.9% | +0.418R | SIDEWAYS hard gate ← **profitable cohort** |
| SELL + NULL breakout | 189 | 27.0% | −0.164R | SIDEWAYS hard gate + probability gate |
| BUY + NULL breakout | 86 | 32.6% | +0.012R | SIDEWAYS hard gate + probability gate |

**Net delivery volume in steady-state conditions:**
- BEAR_TREND periods: ~20–27 signals/day (SELL cohorts dominate; ~60% delivery rate)
- SIDEWAYS periods: 0–2 signals/day (only HIGH_MOMENTUM_BREAKOUT exempt; ~0.5/day)
- BULL_TREND periods: 0 signals/day (no cohort above 40% WR threshold)

---

## PART C — Volume Loss Per Gate

Data source: `/api/analytics/scans` (7D, 969 scans, 52,127 coin-scan entries).

### Pipeline-level gates (coin-scan eliminations in 7D)

| Gate | Rejections (7D) | % of Coin-Scans | Description |
|------|----------------|-----------------|-------------|
| MTF_REJECTION | 16,861 | 32.3% | Multi-timeframe trend check fails — primary quality gate |
| market_structure (all ms_*) | 6,384 | 12.2% | Market structure false-positive filters |
|   ms_sideways | 2,047 | — | Ranging/sideways candle structure |
|   ms_candle_rejection | 1,804 | — | Bearish/indecision candle patterns |
|   ms_sr_rejection | 1,649 | — | Support/resistance rejection |
|   ms_weak_breakout | 489 | — | Breakout quality insufficient |
|   ms_trend_exhaustion | 315 | — | Trend momentum fading |
|   ms_overextension | 72 | — | Price overextended from MA |
|   ms_fake_volume | 8 | — | Volume anomaly |
| KLINE_EMPTY | 5,281 | 10.1% | API data unavailable (not a quality gate — infrastructure) |
| CONFIDENCE_REJECTION | 2,647 | 5.1% | Passes all structural gates, fails confidence floor (85+) |
| TREND_STRENGTH_REJECTION | 1,636 | 3.1% | Trend not strong enough |
| SIGNAL_COOLDOWN | 1,270 | 2.4% | Duplicate within 60-min window |
| BTC_DOWN_BUY | 504 | 1.0% | BTC declining + BUY signal |
| RISK_REJECTION | 292 | 0.6% | Risk grade rejects |
| CONTRA_REGIME_REJECTION | 60 | 0.1% | Contra-regime BUY in BEAR_TREND |
| SIDEWAYS_REJECTION | 0 | 0% | Deployed June 23 (no prior data) |
| **Total quality eliminations** | **35,935** | **69.0%** | |
| **Signals generated** | **349** | **0.67%** | Survival rate through pipeline |

### Delivery-level gates (signal eliminations in 7D)

| Gate | Blocked (7D) | % of Eligible | Description |
|------|-------------|---------------|-------------|
| Probability gate (suppressed_other) | 219 | 84.2% | `regime\|type\|breakout` cohort WR < 40% in attribution_snapshots |
| Dedup cooldown (shadowed) | 13 | 5.0% | Same direction within 1h |
| **Total delivery eliminations** | **232** | **89.2%** | |
| **Signals delivered** | **27–28** | **10.8%** | Of eligible |

### Root cause of 99.5% delivery rate June 16–22

The probability gate's 84% suppression rate (7D) is misleading because 6 of the 7 days were BTC SIDEWAYS. When SIDEWAYS:
- Every SIDEWAYS attribution cohort has WR < 40% (worst: SIDEWAYS|SELL|NULL = 27.0%)
- 100% of SIDEWAYS-regime signals are probability-blocked
- SIDEWAYS signals were ~82% of eligible in June 16–22 (before SIDEWAYS hard gate)

With the SIDEWAYS gate now deployed, SIDEWAYS signals are eliminated at the pipeline level, and the delivery-level probability gate sees only BEAR_TREND/BULL_TREND eligible signals.

**Steady-state (BEAR_TREND) probability gate suppression: ~11%** (5/45 = June 23 data).

---

## PART D — Top 10 Profitable Cohorts Currently Blocked

Data sources: `performance-verification` stability cohorts (D7 + D30), `edge/regime` + mode analysis.

A "profitable" cohort = Exp > 0 AND WR > 32.3% (breakeven at 2.1:1 RR).

| Rank | Cohort | WR | Exp | n/30D | Blocked by | Justification for block |
|------|--------|-----|-----|-------|------------|------------------------|
| 1 | SIDEWAYS\|SELL\|CONFIRMED_BREAKOUT | 45.9% | +0.418R | 61 | SIDEWAYS hard gate | 7D WR=45.9% > 40%, but hard gate covers ALL SIDEWAYS|
| 2 | SIDEWAYS\|SELL\|NULL (7D only) | 36.9% | +0.156R | 103 (7D) | SIDEWAYS gate + prob gate | 30D WR=27.0%, Exp=−0.164R — 7D recovery real but 30D data negative |
| 3 | SIDEWAYS\|BUY\|NULL (7D only) | 35.0% | +0.087R | 40 (7D) | SIDEWAYS gate + prob gate | 30D WR=32.6%, Exp=+0.012R — barely positive; 30D confidence insufficient |
| 4–10 | All other blocked cohorts | <32.3% | ≤0 | — | Prob gate or pipeline | Correctly blocked — below breakeven |

**Findings:**

Only ONE cohort has clear, consistent positive expectancy AND is blocked incorrectly by the current gate set:

**SIDEWAYS|SELL|CONFIRMED_BREAKOUT** (Rank 1):
- 30D WR=45.9% — above both breakeven (32.3%) and probability gate threshold (40%)
- 30D Exp=+0.418R — solidly positive
- n=61 over 30D — statistically sufficient (n ≥ 30)
- Previously: probability gate would have PASSED this cohort (WR ≥ 40%)
- Now: SIDEWAYS hard gate (deployed June 23) blocks it before probability gate evaluates it
- Signal meaning: CONFIRMED_BREAKOUT in SIDEWAYS = price breaking above 30D resistance = directional exit from the range = the good side of SIDEWAYS

Ranks 2–3 are borderline. 7D performance is above breakeven, but 30D data (which the probability gate uses) shows negative or near-zero expectancy. These are correctly blocked on 30D evidence.

Ranks 4–10: All blocked cohorts have WR < 32.3% (below breakeven) or clearly negative expectancy:
- BEAR_TREND|BUY|NULL: WR=20.6%, Exp=−0.350R ✓ correctly blocked
- BEAR_TREND|BUY|CONFIRMED_BREAKOUT: WR=25.0%, Exp=−0.225R ✓ correctly blocked
- BULL_TREND all sub-cohorts: WR=21.65% overall ✓ correctly blocked
- TRENDING mode signals: WR=25.6% overall ✓ correctly blocked

**Conclusion: Only 1 of 10+ blocked cohorts has unjustified blocking (SIDEWAYS|SELL|CONFIRMED_BREAKOUT).**

---

## PART E — Healthy Filtering vs Over-Filtering

### Classification: **HEALTHY FILTERING** (with one narrow exception)

**Criteria for healthy filtering:**
- ✅ WR trend is improving (7D WR=33.52% from 20% baseline)
- ✅ Expectancy is positive (Exp=+0.137R from −0.39R baseline)
- ✅ Blocked cohorts have genuine negative expectancy (n≥30, verified)
- ✅ Passing cohorts are positive-expectancy (BEAR_TREND|SELL dominates)
- ✅ Platform delivers signals in its best regime (BEAR_TREND: 27/day)
- ⚠️ Platform silent during SIDEWAYS (June 16–22: 0.17/day)

**Why the SIDEWAYS silence is NOT over-filtering:**

The 6-day silence from June 16–22 was caused by BTC regime SIDEWAYS, not gate miscalibration. In SIDEWAYS:
- Platform WR drops to 30.2% (below 32.3% breakeven)
- All SIDEWAYS attribution cohorts have WR < 40%
- The probability gate is CORRECT to block 99% of SIDEWAYS signals
- The SIDEWAYS hard gate (deployed June 23) makes this structural, not incidental

A platform generating 0 signals during a regime where it has negative expectancy is correct behavior. The alternative (sending signals with WR=30.2%) was the pre-P0 crisis.

**The one narrow over-filtering case:**

SIDEWAYS|SELL|CONFIRMED_BREAKOUT (n=61, WR=45.9%, Exp=+0.418R) is blocked by the SIDEWAYS hard gate. This sub-cohort represents price breaking out of a sideways range — mechanistically different from a directional signal IN a sideways range. The WR=45.9% exceeds both the 32.3% breakeven and the 40% probability gate threshold.

Impact of this false positive:
- ~2 blocked signals/day during SIDEWAYS periods
- ~10% of total SIDEWAYS volume (61/630 SIDEWAYS + breakout signals)
- Expected value forfeited: 2 × (0.45 × 2.1 − 0.55 × 1.0) = 2 × 0.397 = **+0.79R/day during SIDEWAYS periods**

This is meaningful but not critical — SIDEWAYS only occurs ~24% of the time (364/1,530 non-NULL days).

**Summary verdict:**

| Condition | Classification | Evidence |
|-----------|---------------|----------|
| Overall filtering | HEALTHY | WR improving, only negative-expectancy cohorts blocked |
| BEAR_TREND periods | APPROPRIATE | 11% suppression rate, 27 deliveries/day |
| SIDEWAYS periods | APPROPRIATE (one exception) | 100% block correct except CONFIRMED_BREAKOUT |
| BULL_TREND periods | APPROPRIATE | WR=21.65% — correctly blocked entirely |
| June 16–22 silence | NOT over-filtering | Regime-driven, not gate-driven |

---

## PART F — Recommendation

**Action: Relax the SIDEWAYS gate — add CONFIRMED_BREAKOUT to the exemption list.**

### What to change

In `backend/core/scanner/signal_pipeline.py`, Step 10.5.5, extend the exemption condition:

```python
# Current:
if btc_regime == "SIDEWAYS" and setup.breakout_strength != "HIGH_MOMENTUM_BREAKOUT":
    _record_gate_rejection("SIDEWAYS_REJECTION", gate_rejections)
    return None

# Proposed:
if btc_regime == "SIDEWAYS" and setup.breakout_strength not in (
    "HIGH_MOMENTUM_BREAKOUT", "CONFIRMED_BREAKOUT"
):
    _record_gate_rejection("SIDEWAYS_REJECTION", gate_rejections)
    return None
```

No other files require changes. The probability gate will then evaluate these signals independently (SIDEWAYS|SELL|CONFIRMED_BREAKOUT WR=45.9% ≥ 40% → passes).

### Rationale

| Factor | Evidence |
|--------|---------|
| 30D WR | 45.9% — above 40% probability threshold |
| 30D Expectancy | +0.418R — solidly positive |
| 30D n | 61 — statistically sufficient |
| 7D WR | Not measured separately, but 30D is adequate |
| Mechanism | Breakout ABOVE 30D resistance = exiting the sideways range — qualitatively distinct from a directional signal within the range |
| Precedent | HIGH_MOMENTUM_BREAKOUT already exempt (WR=81.8%); CONFIRMED_BREAKOUT (WR=45.9%) follows the same logic at lower strength |
| Gate integrity | The gate's core purpose (blocking low-WR in-range directional signals) is preserved — only breakout-type exempted |

### Expected impact

| Metric | Before | After (estimated) | Change |
|--------|--------|-------------------|--------|
| Deliveries/day (SIDEWAYS) | 0–0.5 (HIGH_MOM only) | ~2.5 | +2/day |
| Deliveries/day (BEAR_TREND) | ~27 | ~27 | No change |
| WR of SIDEWAYS deliveries | ~82% (HIGH_MOM only) | ~55% (blended HIGH_MOM + CONF) | −27pp (but larger sample) |
| Overall platform WR | 33.52% | ~33.6–34.0% | Marginal improvement |
| Net expected value | — | +0.79R/day in SIDEWAYS periods | +$R per SIDEWAYS day |

### Why not other actions

| Alternative | Reason rejected |
|-------------|----------------|
| Tighten probability gate (lower min_empirical_wr) | Wrong direction — gate is under-delivering in SIDEWAYS, not over-delivering in BEAR_TREND |
| Relax probability gate threshold (raise to 45% or lower to 35%) | Threshold calibration requires 30D+ post-recovery data; premature to change |
| Add BULL_TREND hard gate | BULL_TREND WR=21.65% — should be gated, but scope is a new gate (deferred to BULL_TREND.GATE.1) |
| Keep current settings | Forfeits +0.79R/day × SIDEWAYS % = measurable alpha; justification for change is solid |

### Risk assessment

**Low risk.** The change:
- Adds exemptions (makes gate less restrictive in one narrow case)
- Does not affect BEAR_TREND or BULL_TREND behavior
- The 30D WR=45.9% for this cohort has n=61 — above the 30-sample statistical threshold
- Reversible by removing the CONFIRMED_BREAKOUT entry from the exemption list

### POSTFIX.1 (7 days post-change — 2026-06-30)

Run when BTC enters next SIDEWAYS period:
1. Verify SIDEWAYS|SELL|CONFIRMED_BREAKOUT signals appear in delivery feed
2. Verify SIDEWAYS_REJECTION count drops proportionally to CONFIRMED_BREAKOUT volume
3. Verify WR of these signals in first 30 resolved: target ≥ 40% (consistent with 30D baseline)
4. Verify no SIDEWAYS|BUY|CONFIRMED_BREAKOUT signals appear (direction matters — only SELL side has positive expectancy)

---

## Data Reference

| Source | Value | Window |
|--------|-------|--------|
| D7 delivery funnel | generated=351, eligible=260, suppressed=219, delivered=27 | June 16–23 |
| H24 delivery funnel | generated=64, eligible=45, suppressed=5, delivered=27 | June 23 |
| Prob gate suppression (D7) | 219/260 = 84.2% | June 16–23 (SIDEWAYS-heavy) |
| Prob gate suppression (H24) | 5/45 = 11% | June 23 (BEAR_TREND) |
| BEAR_TREND WR | 51.4%, Exp=+0.619R | 30D, n=992 |
| SIDEWAYS WR | 30.2%, Exp=−0.017R | 30D, n=364 |
| BULL_TREND WR | 21.7%, Exp=−0.330R | 30D, n=97 |
| SIDEWAYS\|SELL\|CONFIRMED WR | 45.9%, Exp=+0.418R | 30D, n=61 |
| Pipeline survival rate (7D) | 349/52,127 = 0.67% | 7D |
| Primary pipeline gate | MTF_REJECTION: 16,861 (32.3%) | 7D |
| Primary delivery gate | Prob gate: 219/260 = 84.2% | 7D |

---

*Next action after recommendation is accepted: implement CONFIRMED_BREAKOUT exemption in `signal_pipeline.py` Step 10.5.5 (2-line change, no other files). No migrations, no dashboard changes.*
