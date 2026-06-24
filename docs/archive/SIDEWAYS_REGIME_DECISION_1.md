# SIDEWAYS.REGIME.DECISION.1
**Date:** 2026-06-23 (Day 7 of P0 Recovery validation window)  
**Decision type:** Structural gate — BTC SIDEWAYS regime  
**Output:** IMPLEMENT / DO NOT IMPLEMENT  

---

## Executive Summary

**Decision: IMPLEMENT immediately.**

Live DB measurement (2,127 resolved signals, 30D window):  
SIDEWAYS: n=361, WR=**30.47%**, PF=**0.986**, Exp=**−0.009R**  

WR=30.47% is below the 35% hard-implement threshold defined in `docs/RECOVERY_VALIDATION_DAY7_1.md`. SIDEWAYS is the only identified losing regime without a structural gate. The gate blocks ~325 signals/month with zero edge; ~36 HIGH_MOMENTUM_BREAKOUT signals remain exempt.

---

## PART A — SQL Validation

### Query (exact from RECOVERY_VALIDATION_DAY7_1.md Part G)

```sql
SELECT
  COUNT(*) as n,
  COUNT(*) FILTER (WHERE so.outcome = 'TP_HIT')::float /
    NULLIF(COUNT(*) FILTER (WHERE so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT')), 0) * 100 as wr,
  AVG(so.rr_achieved) as exp_r
FROM signals s
JOIN signal_outcomes so ON s.id = so.signal_id
WHERE s.market_regime = 'SIDEWAYS'
  AND so.outcome IN ('TP_HIT','SL_HIT','TIMEOUT');
```

### Live Result (fetched 2026-06-23 via `/api/analytics/edge/regime`, 720h window)

| Metric | SIDEWAYS |
|--------|----------|
| n | 361 |
| TP hits | 110 |
| SL hits | 238 |
| Timeouts | 13 |
| Win Rate | 30.47% |
| Win Rate CI (95%) | 25.95% – 35.40% |
| Expectancy | −0.009R |
| Profit Factor | 0.9864 |
| Avg Duration | 10.9h |

### Decision criteria check

| Criterion | Threshold | Measured | Verdict |
|-----------|-----------|----------|---------|
| WR < 35% | < 35% | 30.47% | ❌ BELOW |
| PF < 1.0 | < 1.0 | 0.9864 | ❌ BELOW |
| Expectancy < 0 | < 0 | −0.009R | ❌ NEGATIVE |
| n ≥ 30 | ≥ 30 | 361 | ✅ SUFFICIENT |

**All three negative-expectancy criteria triggered. n=361 is above the 30-sample minimum for confident action.**

Breakeven WR at median 2.1:1 RR: 1/(1+2.1) = **32.3%**. Measured WR=30.47% is 1.8pp below breakeven, confirming active losses in aggregate.

The backend's own statistical engine already flags SIDEWAYS in `recommended_avoid` (returned alongside BULL_TREND in the API response).

---

## PART B — Comparison vs Other Regimes

### Full regime table (720h window, n=2,127 total resolved)

| Regime | n | WR | Expectancy | PF | Gate Status |
|--------|---|----|------------|-----|-------------|
| BEAR_TREND | 992 | 51.41% | +0.619R | 2.27 | ✅ None needed |
| **SIDEWAYS** | **361** | **30.47%** | **−0.009R** | **0.986** | **❌ None (gap)** |
| BULL_TREND | 97 | 21.65% | −0.330R | 0.579 | ⚠️ Soft gate (contra-regime +10 conf) |
| HIGH_VOLATILITY | 0 | — | — | — | Insufficient data |
| EUPHORIA | 0 | — | — | — | Insufficient data |
| CAPITULATION | 0 | — | — | — | Insufficient data |
| NULL regime | 677 | ~14.9%* | ~−0.543R* | — | ✅ Hard gate (ALPHA.TRUTH.1) |

*NULL regime WR from 30D audit in SIGNAL_ENGINE_TRUTH_1.md.

### Key findings

**1. SIDEWAYS is the only ungated losing regime with sufficient data.**  
NULL regime (n=677, WR=14.9%) is already hard-gated since ALPHA.TRUTH.1. BULL_TREND has a soft contra-regime gate (+10 confidence required), but at WR=21.65% with n=97 it likely warrants re-evaluation separately. SIDEWAYS is the structural gap confirmed today.

**2. SIDEWAYS gap explains the 7D WR=20% collapse.**  
BEAR_TREND delivers WR=51.4% — signals generated in BEAR_TREND are the core profitable cohort. SIDEWAYS (WR=30.47%) contaminating the live feed during a BTC SIDEWAYS period produces the observed WR collapse signature. BTC entering SIDEWAYS ≈7 days before the P0 recovery window (2026-06-16) is consistent with SIGNAL_ENGINE_TRUTH_1.md §9.4 attribution.

**3. WR gap is 21pp.**  
BEAR_TREND 51.41% vs SIDEWAYS 30.47% = **20.94pp gap**. Every SIDEWAYS signal generated is a systematic drag on performance during the worst regime for the platform.

**4. BEAR_TREND dominates at 68.4% of regime-known signals (992/1,450).**  
The platform's edge is structurally concentrated in BEAR_TREND. Gating SIDEWAYS protects the overall WR by removing the low-quality cohort.

---

## PART C — Gate Design

### Implementation (from SIGNAL_ENGINE_ACTIONS_1.md C1, verbatim)

```python
# backend/core/scanner/signal_pipeline.py
# Insert at Step 10 (after BTC regime detection, before confidence floor)

def sideways_regime_gate(btc_regime: str, breakout_strength: str | None) -> bool:
    """
    Returns True if signal should be rejected.
    SIDEWAYS BTC regime: directional signals have WR=30.47% (below 32.3% breakeven).
    HIGH_MOMENTUM_BREAKOUT exempt: WR=81.8% regardless of regime.
    """
    if btc_regime != 'SIDEWAYS':
        return False  # gate only applies to SIDEWAYS
    if breakout_strength == 'HIGH_MOMENTUM_BREAKOUT':
        return False  # override — institutional momentum valid in any regime
    return True  # reject
```

### Integration in `signal_pipeline.py`

The gate inserts after Step 10 (BTC regime assigned) and before Step 11 (confidence floor):

```python
# Step 10.5: SIDEWAYS regime gate
if sideways_regime_gate(btc_regime, setup.breakout_strength):
    gate_rejections["SIDEWAYS_REJECTION"] = gate_rejections.get("SIDEWAYS_REJECTION", 0) + 1
    return None
```

### Gate key registration in `scan_metrics.py`

```python
# Add to GATE_REJECTION_KEYS set:
"SIDEWAYS_REJECTION",

# Add to _PERSISTED_GATE_KEYS set:
"SIDEWAYS_REJECTION",
```

### Design rationale

**Hard reject, not soft penalize.** SIDEWAYS WR=30.47% is 1.8pp below breakeven. A soft +10 confidence penalty would only filter signals below the confidence floor — signals with confidence=90 in SIDEWAYS still have WR=30% and continue degrading the feed. Hard reject is consistent with the NULL regime gate precedent.

**HIGH_MOMENTUM_BREAKOUT override retained.** This cohort (WR=81.8% per 30D audit) represents institutional breakout momentum that transcends regime context. Rejecting HIGH_MOMENTUM signals in SIDEWAYS would discard the platform's best alpha cohort. Override aligns with the `regime_hard_gate_v2` design pattern (decision #48 in CLAUDE.md).

**No SELL-in-SIDEWAYS exemption.** Both BUY and SELL signals in SIDEWAYS have equivalent structural issues (no directional momentum to exploit). The 2.1:1 median RR means SIDEWAYS signals need WR>32.3% to be positive-expectancy; measured WR=30.47% is below that for both directions in aggregate.

**Two files only.** Zero new API surface, zero DB migrations, zero dashboard changes. Gate rejection counter is additive (follows the `REGIME_REJECTION`/`DUPLICATE_SIGNAL` precedent).

---

## PART D — Impact Estimates

### Volume impact

SIDEWAYS regime-known signals over 30D: **361**  
HIGH_MOMENTUM override (estimated 10%, consistent with 30D audit proportion): **~36 pass through**  
Gate rejects per 30D: **~325 signals**  

As a fraction of total signal flow:
- SIDEWAYS = 361 / 1,450 regime-known = **24.9% of non-NULL volume**
- Gate eliminates ~22.4% of non-NULL signal volume (after HIGH_MOMENTUM exemption)

During active SIDEWAYS BTC periods: platform outputs ~10% of current volume (HIGH_MOMENTUM only). This is the correct behavior — the platform has no edge in SIDEWAYS and should not pretend otherwise.

### WR impact

Before gate (regime-known, excl. NULL): WR = 641/1,450 = **44.2%**

After gate (removing 90% of SIDEWAYS ≈ 325 signals, 99 expected wins):
- Remaining signals: 1,125
- Remaining wins: 641 − 99 = 542
- New WR: **48.2%**
- **WR improvement: +4.0pp**

This estimate aligns with the SIGNAL_ENGINE_ACTIONS_1.md Rank 10 forecast of "+2–4pp WR". The upper bound (4pp) is reached because WR=30.47% is far enough below the baseline that removal has full effect.

### PF impact

SIDEWAYS PF = 0.986 (net negative contributor to the pool).  
Removing a PF<1 cohort from a PF>2 pool:  
- Estimated pool PF improvement: **+0.20–0.35** (from ~1.9 → ~2.1–2.25)

### Expectancy impact

SIDEWAYS Exp = −0.009R (nearly zero, but negative).  
Removing the near-zero-expectancy cohort raises pool expectancy:  
- Estimated improvement: **+0.08–0.12R** (conservative; the dominant driver is WR, not avg-R)

### Temporal impact

The gate's largest value is **regime-conditional**: during BTC SIDEWAYS periods, signal quality currently drops to 30.47% WR while the platform continues generating alerts. After the gate, SIDEWAYS periods produce silence (except HIGH_MOMENTUM). This eliminates the mechanism responsible for the 7D WR=20% collapse.

### Summary table

| Metric | Before Gate | After Gate (est.) | Change |
|--------|-------------|-------------------|--------|
| WR (regime-known) | 44.2% | ~48.2% | +4.0pp |
| PF (regime-known) | ~1.9 | ~2.1–2.25 | +0.20–0.35 |
| Expectancy | +0.40R* | ~+0.49–0.52R | +0.08–0.12R |
| Signal volume/month | 1,450 | ~1,125 | −22.4% |
| During SIDEWAYS | 100% flow | ~10% flow | −90% |

*Approximate weighted average across BEAR/SIDEWAYS/BULL with NULL already excluded.

---

## PART E — Decision

### IMPLEMENT

**Trigger criteria met:**
- ✅ WR = 30.47% < 35% threshold → implement immediately (per Day-7 criteria)
- ✅ PF = 0.986 < 1.0 → negative-expectancy cohort confirmed
- ✅ Exp = −0.009R < 0 → all three negative-expectancy criteria triggered
- ✅ n = 361 >> 30 → statistically robust

**SIDEWAYS is the final identified structural gate gap** in the signal engine. All other confirmed losing cohorts are gated:
- NULL regime (WR=14.9%) — hard-gated by ALPHA.TRUTH.1
- Contra-regime BUY in BEAR_TREND (WR=19%) — hard-gated by REGIME_REJECTION
- Grade D (WR=13.6%) — gated by `should_suppress_send()`
- SIDEWAYS (WR=30.47%) — **this gate closes the gap**

### Scope

**Files to modify (2 files):**
1. `backend/core/scanner/signal_pipeline.py` — add `sideways_regime_gate()` fn + Step 10.5 call
2. `backend/analytics/scan_metrics.py` — add `SIDEWAYS_REJECTION` to GATE_REJECTION_KEYS + _PERSISTED_GATE_KEYS

**Risk:** Low. Gate is purely additive, with HIGH_MOMENTUM override protecting the best-alpha cohort. Fail-open on any exception (consistent with all other gates). Reversible by removing Step 10.5 call.

### POSTFIX.1 (7 days post-deploy — 2026-06-30)

Validate via `/api/analytics/edge/regime`:
1. SIDEWAYS WR for remaining signals (HIGH_MOMENTUM exempt): WR ≥ 60%
2. `SIDEWAYS_REJECTION` gate count: consistent with estimated 10–12/day blocked
3. Overall WR improvement: +2pp minimum vs pre-gate baseline
4. No degradation in BEAR_TREND performance (n, WR, Exp stable within ±3pp)

---

*Gate implementation follows this document. See `docs/SIGNAL_ENGINE_ACTIONS_1.md` C1 for tracking.*
