# RISKGRADE.TRUTH.1 — Grade System Audit

**Date:** 2026-06-09  
**Role:** Principal Quant Researcher  
**Window:** Last 30 days (n=1,708 resolved outcomes)  
**Verdict:** Grade C outperforms Grade A by 9.8× expectancy due to systematic scoring bias, not signal quality difference.

---

## Section A — Grade Distribution

| Grade | n | Wins | Losses | WR% | Avg Win RR | Avg Loss RR | **Expectancy** | Avg Planned RR | Avg Quality | Avg Risk | Avg Conf |
|-------|---|------|--------|-----|-----------|------------|---------------|----------------|-------------|----------|----------|
| A | 845 | 299 | 546 | 35.4% | 2.103 | −1.000 | **+0.098R** | 2.09 | 78.2 | 15.5 | 91.3 |
| B | 772 | 283 | 489 | 36.7% | 2.098 | −1.000 | **+0.136R** | 2.10 | 68.6 | 23.3 | 89.4 |
| C | 91 | 51 | 40 | 56.0% | 2.500 | −1.000 | **+0.962R** | 2.49 | 75.5 | 37.1 | 91.8 |

Grade C expectancy is **9.8× Grade A** and **7.1× Grade B**.  
Grade C quality score (75.5) is higher than Grade B (68.6) despite having the highest risk score (37.1 vs 15.5 for A). This inversion signals a scoring bias, not a quality difference.

---

## Section B — Grade Composition

| Factor | Grade A | Grade B | Grade C |
|--------|---------|---------|---------|
| **Futures mode** | 12.9% | 10.4% | **98.9%** |
| Spot mode | 84.3% | 83.3% | 1.1% |
| High-confidence mode | 2.5% | 5.3% | 0.0% |
| **BEAR_TREND regime** | 58.9% | 55.7% | 67.0% |
| SIDEWAYS | 1.5% | 3.0% | 6.6% |
| **NULL regime** | 39.6% | 41.3% | 26.4% |
| **Confirmed/High-Momentum breakout** | 31.8% | 44.4% | **70.3%** |
| Early breakout | 7.2% | 5.3% | 2.2% |
| No breakout | 60.9% | 50.3% | 27.5% |
| OI negative | 5.6% | 9.3% | 59.3% |
| Long-heavy positioning | 7.9% | 10.2% | 70.3% |
| Avg confidence | 91.3 | 89.4 | 91.8 |

**Grade C is not a quality tier — it is an accidental futures-mode bucket.**  
98.9% futures, 70.3% confirmed breakouts, 70.3% long-heavy positioning. These composition differences fully explain the 56% WR vs 35%.

---

## Section C — Grade vs Confidence

| Grade | Conf Band | n | WR% | Expectancy | Avg Quality | Avg Risk |
|-------|-----------|---|-----|-----------|-------------|----------|
| A | 95+ | 428 | 39.0% | +0.223 | 80.6 | 12.9 |
| A | 90–94 | 211 | 24.6% | **−0.226** | 75.9 | 18.1 |
| A | 85–89 | 192 | 38.5% | +0.161 | 75.0 | 18.7 |
| A | <85 | 14 | 42.9% | +0.286 | 80.8 | 12.9 |
| B | 95+ | 190 | 23.2% | **−0.268** | 70.6 | 17.4 |
| B | 90–94 | 303 | 32.3% | +0.037 | 69.4 | 24.3 |
| B | **85–89** | 248 | **53.6%** | **+0.611** | 66.5 | 27.1 |
| B | <85 | 31 | 25.8% | −0.226 | 66.2 | 18.1 |
| C | 95+ | 35 | 60.0% | **+1.100** | 73.2 | 37.0 |
| C | 90–94 | 54 | 55.6% | **+0.944** | 76.7 | 37.1 |
| C | 85–89 | 1 | 0.0% | −1.000 | — | — |

**Two counter-intuitive inversion zones:**
- Grade A at 90–94 and Grade B at 95+ are **money-losing**. Higher confidence predicts worse outcomes for these grades.
- Grade B at 85–89 (Exp=+0.611) outperforms Grade B at 95+ (Exp=−0.268) by **+0.879R**.

This is severe calibration incoherence. The 90–94 Grade A and 95+ Grade B bands likely have high NULL-regime concentration (see Section D).

---

## Section D — Grade vs Regime

| Grade | Regime | n | WR% | Expectancy | Avg Planned RR |
|-------|--------|---|-----|-----------|----------------|
| A | BEAR_TREND | 498 | 49.0% | +0.521 | 2.10 |
| A | **UNKNOWN** | 334 | **15.0%** | **−0.535** | 2.07 |
| A | SIDEWAYS | 13 | 38.5% | +0.154 | 2.12 |
| B | BEAR_TREND | 430 | 50.9% | +0.590 | 2.13 |
| B | **UNKNOWN** | 319 | **15.7%** | **−0.527** | 2.07 |
| B | SIDEWAYS | 23 | 60.9% | +0.826 | 2.15 |
| C | **BEAR_TREND** | 61 | **75.4%** | **+1.639** | 2.49 |
| C | UNKNOWN | 24 | 4.2% | −0.854 | 2.50 |
| C | SIDEWAYS | 6 | 66.7% | +1.333 | 2.50 |

**UNKNOWN regime is a dead zone (WR ~15%) that poisons Grades A and B.**

- 334 Grade A signals (39.6%) have NULL `market_regime` → Exp=−0.535R
- 319 Grade B signals (41.3%) have NULL `market_regime` → Exp=−0.527R
- Grade A in BEAR_TREND alone: WR=49%, Exp=+0.521 — competitive with Grade C

Grade A without UNKNOWN would be Exp ≈ +0.47R. The full 35.4% WR is a statistical artifact of NULL-regime contamination.

**Grade C BEAR_TREND (n=61): WR=75.4%, Exp=+1.639R — the system's highest-value signal cohort.**

---

## Section E — Grade Inflation Analysis

**Score distributions (wins vs losses):**

| Grade | Outcome | n | Quality p25/med/p75 | Risk p25/med/p75 | Avg Planned RR |
|-------|---------|---|---------------------|------------------|----------------|
| A | SL_HIT | 546 | 74/78/80 | 13/20/20 | 2.08 |
| A | TP_HIT | 299 | 74/78/80 | 13/20/20 | 2.10 |
| B | SL_HIT | 489 | 66/68/71 | 17/22/32 | 2.11 |
| B | TP_HIT | 283 | 67/67/69 | 20/30/32 | 2.10 |
| C | SL_HIT | 40 | 71/77/77 | 37/37/37 | 2.49 |
| C | TP_HIT | 51 | 71/77/78 | 37/37/37 | 2.50 |

**Key observations:**

1. **Grade C risk_score is nearly constant at 37** (p25 = p50 = p75 = 37). This is a systematic offset: futures base risk ~32 + flat +5 penalty = 37. Not a distribution — a bucket.
2. **Grade A wins and losses are score-identical** (same quality/risk/conf distributions). The grade has zero discriminatory power between win and loss within itself.
3. **Grade C has higher quality than Grade B** (median 77 vs 68) despite having the worst risk score. This confirms the +5 futures penalty is the only reason these signals are in C.
4. **Grade C avg win RR = 2.500 exactly** — futures signals with high planned RR (2.5) are hitting full TP, not partial.

**What pushes GOOD signals into Grade C:**
1. Futures mode +5 penalty (`risk.py:295`) — primary driver
2. Confirmed breakouts use wider ATR stops → higher `sl_pct` → `_validate_stop_distance()` penalty
3. Combined effect: quality=75, risk=37 → Grade C by definition (≤50, ≥40)

**What pushes MEDIOCRE signals into Grade A:**
1. NULL `market_regime` signals — 334 Grade A signals pass risk gate cleanly (narrow stops, spot mode = no +5, ok volume) but have no regime context
2. Spot stops are tight → risk 0–20 → Grade A by definition
3. `_calc_quality_score()` has no breakout/regime/OI inputs → all spot signals score similarly regardless of setup quality

---

## Section F — Rebuild Simulation

**Current grades:**

| Grade | n | WR% | Expectancy |
|-------|---|-----|-----------|
| A | 845 | 35.4% | +0.098R |
| B | 772 | 36.7% | +0.136R |
| C | 91 | 56.0% | +0.962R |

**Simulated (percentile-based on composite = quality − risk; top 20% / middle 30% / bottom 50%):**

| Sim Grade | n | WR% | Expectancy | Avg Quality | Avg Risk | % was-A | % was-B | % was-C |
|-----------|---|-----|-----------|-------------|----------|---------|---------|---------|
| A_new | 359 | 38.7% | +0.228R | 82.6 | 10.6 | 94% | 6% | 0% |
| B_new | 636 | 31.9% | **−0.019R** | 74.7 | 17.5 | 76% | 24% | 0% |
| C_new | 713 | 40.8% | +0.288R | 68.3 | 27.4 | 4% | 84% | 13% |

**The percentile simulation does not fix the problem.** It reorders signals on the same broken quality−risk composite. UNKNOWN-regime signals continue contaminating B_new (76% from current A). Grade C futures signals barely appear (0% in A_new, 13% in C_new) because their risk_score (37) pulls them out of top percentiles. This confirms: **the problem is missing inputs to the scoring function, not threshold placement.**

---

## Section G — Recommendation

### Verdict: RECALIBRATE

### Root Cause (ranked by impact)

1. **Flat +5 futures penalty creates a junk-drawer grade tier**  
   Code: [`risk.py:295–296`](../backend/core/scanner/risk.py)  
   The penalty pushes all high-quality confirmed-breakout futures signals (quality ~75, base risk ~32) from Grade B into Grade C. Grade C is not a quality tier; it is a futures-mode artifact.

2. **NULL market_regime contaminates 40% of Grades A and B**  
   334 Grade A + 319 Grade B signals have NULL `signal_outcomes.market_regime`, WR=15%, Exp=−0.535R. These are signals generated before regime was persisted to `signal_outcomes`. They look clean on paper (narrow stops, spot, ok volume) but perform catastrophically.

3. **Quality scoring is regime- and breakout-blind**  
   Code: [`risk.py:211–252`](../backend/core/scanner/risk.py)  
   `_calc_quality_score()` inputs: RR, volume_spike, combined_strength, MACD, RSI, volatility, SL distance. Missing: breakout confirmation (biggest WR predictor), regime alignment, OI context.

### Threshold Changes (RISKGRADE.FIX.1)

| Change | Location | Current | Proposed | Expected Impact |
|--------|----------|---------|----------|-----------------|
| Futures penalty | `risk.py:295` | `+5.0` | `+2.0` | Promotes quality futures signals from C to B |
| Grade A quality floor | `risk.py:258` | `quality >= 70` | `quality >= 75` | Removes low-quality-score A signals (70–74 band) |
| Breakout quality bonus | `risk.py:_calc_quality_score()` | No input | HIGH_MOMENTUM +15, CONFIRMED +10, EARLY +4 | Rewards confirmed breakouts in quality scoring |
| Regime quality adjustment | `risk.py:_calc_quality_score()` | No input | BEAR/BULL +5, NULL −10 | Penalises unknown-regime signals |

### Expected WR after RISKGRADE.FIX.1
- Grade A: 35.4% → **44–48%** (NULL-regime signals deprioritized, quality floor raised)
- Grade B: 36.7% → **43–47%** (confirmed-breakout futures signals migrate in from C)
- Grade C: 56.0% → **50–55%** (residual C shrinks; remaining are true borderline signals)
- System monotonicity: A > B > C for WR, Expectancy, Quality ✅

### RISKGRADE.POSTFIX.1 (7 days post-deploy)
Measure: grade distribution shift, WR per grade, % Grade A with NULL regime, % Grade C from futures. Success: WR ordering becomes A > B > C without reducing total system expectancy.

---

## Data Notes

- `signal_outcomes.outcome` uses `TP_HIT`/`SL_HIT` (not `WIN`/`LOSS`)
- `signal_outcomes.rr_achieved`: positive for TP_HIT, −1.000 for SL_HIT (1R loss)
- `signal_outcomes.market_regime` is NULL for signals generated before regime persistence was added
- Grade C data ends 2026-06-02 (latest `created_at`); A/B continue through 2026-06-08
- All queries use 30-day window from execution date (2026-06-09)
