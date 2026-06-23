# ALPHA.MONITORING.1
**Period:** 2026-06-23 → 2026-06-30 (7 days)  
**Start date:** 2026-06-23 ~12:30 UTC  
**Purpose:** Validate that P0/P1/SIDEWAYS gate improvements hold under live production data.  
**Mode:** Observe only — no strategy changes during this period.  

---

## Freeze Declaration

The following are frozen for the duration of this monitoring window:

| Component | Status |
|-----------|--------|
| NULL regime hard gate (ALPHA.TRUTH.1) | 🔒 FROZEN |
| SIDEWAYS hard gate + CONFIRMED_BREAKOUT exemption (SIDEWAYS.EXEMPTION.1) | 🔒 FROZEN |
| Contra-regime gate v2 (`regime_hard_gate_v2=ON`) | 🔒 FROZEN |
| Probability gate (`probability_gate_v1=ON, min_empirical_wr=40.0`) | 🔒 FROZEN |
| Early breakout penalty (`early_breakout_penalty_v1=ON`) | 🔒 FROZEN |
| RiskGrade V2 (`riskgrade_v2=ON`) | 🔒 FROZEN |
| TRENDING confidence floor (85) | 🔒 FROZEN |
| FUTURES confidence floor (85) | 🔒 FROZEN |
| All probability thresholds | 🔒 FROZEN |
| All confidence scoring logic | 🔒 FROZEN |
| All indicators | 🔒 FROZEN |

**Only permitted changes:** Infrastructure, logging, dashboarding, documentation.

---

## Starting Baseline (2026-06-23)

### Core metrics

| Metric | D7 Value | D30 Reference | Breakeven |
|--------|----------|---------------|-----------|
| Win Rate | **33.15%** | 34.84% | 32.3% at 2.1:1 RR |
| Profit Factor | **1.2040** | 1.1510 | 1.0 |
| Expectancy | **+0.1245R** | +0.0976R | 0.000R |
| Resolved (7D) | 178 | 2,130 | — |

### Signal volume

| Metric | H24 | D7 |
|--------|-----|----|
| Generated | 66 | 352 |
| Eligible (conf ≥ 85) | 46 | 261 |
| Probability gate suppressed | 6 (13%) | 220 (84%) |
| Dedup shadowed | 13 | 13 |
| Delivered | 27 | 27 |

Note: D7 suppression (84%) is elevated because June 16–22 BTC was SIDEWAYS. H24 (13%) reflects current BEAR_TREND regime. Expect delivery to track regime.

### Sentinel cohorts (starting WR)

| Cohort | n (30D) | WR | Exp | Source | Alert threshold |
|--------|---------|-----|-----|--------|----------------|
| SIDEWAYS\|SELL\|CONFIRMED_BREAKOUT | 61 | **45.9%** | +0.418R | Pre-exemption 30D data | WR < 40% on n≥10 resolved |
| BEAR_TREND\|SELL\|HIGH_MOMENTUM_BREAKOUT | 33 | **81.8%** | +1.621R | D30 stability | WR < 60% on n≥10 |
| OI_NEUTRAL (all modes) | ~38 (est.) | **~76.3%** | +1.776R | SIGNAL_ENGINE_TRUTH_1.md | WR < 50% on n≥10 |

### Mode breakdown (30D)

| Mode | n | WR | Exp |
|------|---|-----|-----|
| futures | 345 | 44.1% | +0.574R |
| spot | 1,594 | 33.8% | +0.016R |
| trending | 117 | 28.2% | −0.151R |
| high_confidence | 74 | 25.7% | +0.027R |

### Regime breakdown (30D)

| Regime | n | WR | Exp | PF |
|--------|---|-----|-----|-----|
| BEAR_TREND | 992 | 51.4% | +0.619R | 2.273 |
| SIDEWAYS | 364 | 30.2% | −0.017R | 0.974 |
| BULL_TREND | 97 | 21.6% | −0.330R | 0.579 |
| NULL (gated) | 677 | ~14.9% | ~−0.543R | — |

---

## Alert Thresholds

### Hard alerts — immediate attention required

| Alert | Threshold | Baseline | Trigger margin |
|-------|-----------|----------|---------------|
| WR CRITICAL | **< 30%** | 33.15% | −3.15pp |
| PF CRITICAL | **< 1.0** | 1.2040 | −0.204 |
| Expectancy CRITICAL | **< 0** | +0.1245R | −0.1245R |
| SIDEWAYS exemption WR | **< 40%** on n≥10 | 45.9% | −5.9pp |

### Soft alerts — monitor, do not act

| Alert | Threshold | Baseline | Note |
|-------|-----------|----------|------|
| WR warning | < 32.3% (breakeven) | 33.15% | Below breakeven but above hard alert |
| Volume warning | < 20 generated/day | 66/day | May reflect SIDEWAYS regime, not gate failure |
| HIGH_MOMENTUM WR drop | < 60% | 81.8% | Should self-correct; only act if sustained |
| OI_NEUTRAL gate | Appears in attribution_snapshots n≥30 | fail-open | Verify empirical_wr ≥ 60% before promotion |

### Non-alert signals (expected behavior)

| Signal | Reason not an alert |
|--------|-------------------|
| Low delivery count (0–3/day) | SIDEWAYS BTC regime — intended gate behavior |
| 80–90% probability gate suppression | Expected in SIDEWAYS regime; not a malfunction |
| CONFIRMED_BREAKOUT signals absent | Requires BTC SIDEWAYS + matching coin structure |
| claude_fallback_pct = 100% | AI toggle off; WR achieved entirely heuristic — not degradation |

---

## Measurement Protocol

### Endpoints to query

| Endpoint | Measures | Cadence |
|----------|----------|---------|
| `/api/analytics/track-record` | WR, PF, Exp by window | Each checkpoint |
| `/api/analytics/performance-verification` | Cohort stability (D7 + D30), grade validation | Each checkpoint |
| `/api/analytics/telegram-delivery` | Generated/eligible/delivered/suppressed | Each checkpoint |
| `/api/analytics/monitor` | Operational health, signals/day | Each checkpoint |
| `/api/analytics/edge/regime` | Regime WR breakdown | D3, D7 |
| `/api/analytics/scans?window_hours=168` | Gate rejection counts, scan metrics | D7 only |

### Check schedule

| Checkpoint | Date | Focus |
|-----------|------|-------|
| **D3** | 2026-06-26 | Detect any early regression; verify gate rejections are stable |
| **D7** | 2026-06-30 | Full measurement; POSTFIX.1 for SIDEWAYS.EXEMPTION.1 |

D1 and D2 require no measurement unless an alert is triggered.

---

## D3 Measurement (2026-06-26)

*Fill in on 2026-06-26.*

### Core metrics

| Metric | D3 Measured | vs Baseline | Alert? |
|--------|------------|-------------|--------|
| Win Rate (7D rolling) | — | — | — |
| Profit Factor (7D rolling) | — | — | — |
| Expectancy (7D rolling) | — | — | — |
| Resolved (7D) | — | — | — |

### Volume

| Metric | D3 Value |
|--------|----------|
| Generated/day (avg) | — |
| Delivered/day (avg) | — |
| Prob gate suppression % | — |
| BTC regime (current) | — |

### Sentinel cohorts (D3)

| Cohort | WR | n (new post-exemption) | Alert? |
|--------|-----|------------------------|--------|
| SIDEWAYS\|SELL\|CONFIRMED_BREAKOUT | — | — | — |
| BEAR_TREND\|SELL\|HIGH_MOMENTUM | — | — | — |
| OI_NEUTRAL | — | — | — |

### D3 Assessment

*Fill in.*

---

## D7 Measurement (2026-06-30) — Primary Decision Point

*Fill in on 2026-06-30.*

### Core metrics

| Metric | D7 Measured | vs 2026-06-23 Baseline | vs Recovery Target | Alert? |
|--------|------------|------------------------|-------------------|--------|
| Win Rate (7D rolling) | — | — | 33–38% | — |
| Profit Factor (7D rolling) | — | — | 0.95–1.35 | — |
| Expectancy (7D rolling) | — | — | −0.05 to +0.15R | — |
| Resolved (7D) | — | — | n≥50 | — |

### Volume

| Metric | D7 Value | Note |
|--------|----------|------|
| Generated/day (7D avg) | — | — |
| Delivered/day (7D avg) | — | — |
| Prob gate suppression (7D) | — | — |
| BTC regime distribution | — | BEAR/SIDEWAYS/BULL breakdown |

### Sentinel cohort D7 check

| Cohort | WR (D30 rolling) | n (30D) | New resolved (post-Jun23) | Alert? |
|--------|-----------------|---------|--------------------------|--------|
| SIDEWAYS\|SELL\|CONFIRMED_BREAKOUT | — | — | — | — |
| BEAR_TREND\|SELL\|HIGH_MOMENTUM | — | — | — | — |
| OI_NEUTRAL | — | — | — | — |

### Gate health D7

| Gate | Rejection count (7D) | Status |
|------|---------------------|--------|
| REGIME_REJECTION (NULL gate) | — | — |
| CONTRA_REGIME_REJECTION | — | — |
| SIDEWAYS_REJECTION | — | — |
| CONFIDENCE_REJECTION | — | — |
| RISK_REJECTION (Grade D) | — | — |

### SIDEWAYS.EXEMPTION.1 POSTFIX.1 check

Per `docs/SIDEWAYS_EXEMPTION_1.md` postfix criteria:

| Check | Target | Measured | Pass? |
|-------|--------|----------|-------|
| SIDEWAYS_REJECTION count (7D) | Consistent, <12/day (EARLY+NULL still blocked) | — | — |
| CONFIRMED_BREAKOUT signals in delivery | ≥1 if any SIDEWAYS period occurred | — | — |
| SIDEWAYS\|SELL\|CONFIRMED WR (if n≥10) | ≥40% | — | — |
| No EARLY_BREAKOUT or NULL signals in SIDEWAYS delivery | 0 count | — | — |

### D7 Decision

*Complete on 2026-06-30. Use this framework:*

```
IF WR ≥ 33% AND PF ≥ 1.0 AND Exp > 0:
    → CONTINUE monitoring. Consider BULL_TREND gate assessment.

IF WR 30–33% AND PF ≥ 1.0 AND Exp > 0:
    → WATCH. No action. Schedule D14 check.

IF WR < 30% OR PF < 1.0 OR Exp < 0:
    → ALERT. Diagnose by regime. Do not revert gates blindly.
      Check: which regime is responsible?
      If SIDEWAYS exemption signals: check CONFIRMED_BREAKOUT WR.
      If BEAR_TREND degrading: separate systemic concern, not gate issue.

IF SIDEWAYS|SELL|CONFIRMED WR < 40% (n≥10):
    → REVERT SIDEWAYS.EXEMPTION.1 — 2-line change in signal_pipeline.py Step 10.5.5.
      Revert: change `not in ("HIGH_MOMENTUM_BREAKOUT", "CONFIRMED_BREAKOUT")`
              back to `!= "HIGH_MOMENTUM_BREAKOUT"`.
```

---

## Measurement Reference Queries

### Core metrics

```
GET /api/analytics/track-record
→ windows.d7: {resolved, wins, losses, pf, win_rate, expectancy}
→ by_mode_30d: WR per mode (spot, futures, trending)
```

### Sentinel cohort check

```
GET /api/analytics/performance-verification
→ stability.top_cohorts.d30[]
  Look for:
    "BEAR_TREND|SELL|HIGH_MOMENTUM_BREAKOUT" → WR, n
    "SIDEWAYS|SELL|CONFIRMED_BREAKOUT"       → WR, n
→ accuracy.by_mode[]
  Look for:
    "futures" → actual_wr (OI_NEUTRAL proxy)
```

### Delivery funnel

```
GET /api/analytics/telegram-delivery
→ h24: {generated, eligible, suppressed_other, delivered}
→ d7:  {generated, eligible, suppressed_other, delivered}
Compute: suppression_rate = suppressed_other / eligible
```

### Monitor snapshot

```
GET /api/analytics/monitor
→ metrics.signals_per_day.value    (healthy > 30)
→ metrics.win_rate_pct.value       (alert if < 30.0)
→ metrics.telegram_sends_per_day.value
```

### Gate rejection counts

```
GET /api/analytics/scans?window_hours=168
→ gate_rejections:
    REGIME_REJECTION          (NULL gate — should be 0 for new signals)
    CONTRA_REGIME_REJECTION   (regime v2)
    SIDEWAYS_REJECTION        (sideways gate — EARLY+NULL only now)
    CONFIDENCE_REJECTION      (confidence floor)
    RISK_REJECTION            (Grade D)
```

---

## Context Reference

### What changed before this monitoring window

| Date | Change | Commit |
|------|--------|--------|
| 2026-06-16 | P0 gates: NULL regime, probability gate, regime v2, early breakout penalty, riskgrade v2, FUTURES/TRENDING floors | P0 package |
| 2026-06-23 | SIDEWAYS hard gate (WR=30.22%) | `38b52fb` |
| 2026-06-23 | SIDEWAYS.EXEMPTION.1: CONFIRMED_BREAKOUT exempt from SIDEWAYS gate | `d0f949a` |

### Gate precedence order in pipeline

```
Step 10 (pre-gate): BTC regime assigned from Redis cache
  ↓
Step 10.5: Contra-regime gate (BEAR_TREND|BUY / BULL_TREND|SELL, unless HIGH_MOMENTUM or OI)
  ↓
Step 10.5.5 SIDEWAYS gate: reject SIDEWAYS unless HIGH_MOMENTUM or CONFIRMED_BREAKOUT
  ↓  [SIDEWAYS.EXEMPTION.1: CONFIRMED passes here now]
Step 11: AI / heuristic validation → confidence score
  ↓
Confidence floor check (85 minimum, mode-specific)
  ↓
Probability gate: cohort WR < 40% → suppress delivery (not rejection)
  ↓
WhatsApp delivery
```

### Pre-deployment reference baselines

| Period | WR | PF | Exp | Source |
|--------|-----|-----|-----|--------|
| Pre-P0 (crisis) | 20.0% | 0.52 | −0.39R | SIGNAL_ENGINE_TRUTH_1.md |
| D7 post-P0 | **33.15%** | **1.204** | **+0.124R** | This document (starting baseline) |
| Recovery target | 33–38% | 0.95–1.35 | −0.05 to +0.15R | RECOVERY_VALIDATION_DAY7_1.md |

---

## Notes for D3/D7 Analyst

**On SIDEWAYS exemption cohort:** The 45.9% WR baseline is from 30D pre-exemption data. Post-exemption signals only accumulate when BTC enters SIDEWAYS AND a coin triggers CONFIRMED_BREAKOUT. If BTC remains in BEAR_TREND the entire monitoring window, no new exemption signals will be generated — this is expected behavior, not a data gap. The 30D rolling WR will dilute only slowly as old data ages out.

**On HIGH_MOMENTUM cohort:** This is the system's highest-value cohort (WR=81.8%, Exp=+1.621R). A single measurement with low n will show variance. The monitoring check is for sustained deterioration, not one-point deviation. Require n≥10 new resolved before triggering soft alert.

**On OI_NEUTRAL:** No dedicated attribution snapshot cell exists yet (n<30). The cohort is fail-open — passes the probability gate. Monitor via `/api/analytics/edge/report` → `confidence_calibration` futures breakdown as a proxy. If `futures actual_wr` drops significantly, investigate whether OI_NEUTRAL is contributing.

**On volume:** Signal volume is regime-gated by design. During SIDEWAYS: 2–3 deliveries/day (HIGH_MOMENTUM + CONFIRMED). During BEAR_TREND: 20–30/day. Do not confuse low-volume SIDEWAYS periods with gate malfunction.

**On BULL_TREND:** WR=21.65%, ungated. If BULL_TREND regime occurs during this window, signals from it will pass all pipeline gates but be blocked by the probability gate (cohort WR < 40%). They count toward "generated" but not "delivered". No action needed — monitoring only.

---

*Next action after this window closes (2026-06-30): complete D7 measurement, decide on BULL_TREND gate (WR=21.65%, Exp=−0.330R — the last ungated losing regime).*
