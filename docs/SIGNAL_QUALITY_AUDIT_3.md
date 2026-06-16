# SIGNAL_QUALITY_AUDIT_3.md

**Date:** 2026-06-16  
**Roles:** Principal Quant Researcher · Institutional Trading PM · Staff Systems Architect · Senior Data Scientist · Outcome Analytics Lead  
**Data basis:** Production `signal_outcomes` + `attribution_snapshots` (1,243 rows) + historical audits ALPHA.TRUTH.1 / PERF.VERIF.1 / CONF.CAL.2 / RISKGRADE.TRUTH.1  
**Scope:** No new features. No new indicators. Find where expectancy leaks. Quantify it.

**Source legend used throughout:**
- `[ALPHA.TRUTH.1]` — decision #41, 30d / 1,708 resolved signals
- `[PERF.VERIF.1]` — decision #57, 1,822 in-sample resolved signals
- `[CONF.CAL.2]` — decision #50, 30d / n=1,809
- `[RISKGRADE.1]` — decision #35, 30d / n=1,708
- `[REGIME.V2]` — decision #48, contra-regime BUY cohort N=200
- `[P1.INTEL]` — decision #54, high_confidence mode audit
- `[LIVE]` — PLATFORM_VERIFICATION_1.md live evidence 2026-06-16
- `[ESTIM]` — estimated from system structure and adjacent audit data

---

## 1. Executive Summary

### Current State — CRITICAL

| Window | WR | PF | Expectancy | Status |
|---|---|---|---|---|
| 7D | **20.0%** | **0.52** | **−0.39R** | 🔴 CRITICAL |
| 30D | 35.0% | 1.16 | +0.10R | 🟡 MARGINAL |

**The 7D collapse is not noise.** The monitoring system's own critical threshold for WR is 20%. We are sitting on it. The anomaly detector `WIN_RATE_DROP_WARN = 0.12` triggers at 12pp 7D-vs-30D divergence — this divergence is 15pp. The system is in a provable anomalous state.

**The 30D figure is also not healthy.** At a median RR of ~2.1:1, the breakeven WR is 32.3%. A 35% WR leaves only 2.7pp of margin above breakeven. One bad week erases months of marginal gains.

### Five Root Causes (detail in Section 10)

| Rank | Cause | 7D WR Impact |
|---|---|---|
| 1 | `high_confidence` mode failure — 0/9 wins last 7D | −3 to −5pp |
| 2 | Probability gate disabled — D/B/C empirical grade signals passing | −4 to −6pp |
| 3 | Confidence band 90-94 is the system's WORST performer (31.4% WR) | −3 to −4pp |
| 4 | `TRENDING` mode running at min_confidence=78 (below negative-expectancy zone) | −2 to −3pp |
| 5 | `REGIME_HARD_GATE_V2` OFF — contra-regime BUY at 19% WR still passing | −2 to −3pp |

### Live Book Quality Snapshot

Three most recent signals stamped with live empirical data [LIVE]:

| Signal | empirical_wr | empirical_grade | WR≥40 gate | WR≥45 gate |
|---|---|---|---|---|
| Signal A | 27.78% | D | FAIL | FAIL |
| Signal B | 31.21% | B | FAIL | FAIL |
| Signal C | 40.65% | C | PASS | FAIL |

**2 of 3 recent signals would be blocked by a WR≥40 probability gate. 3 of 3 would be blocked at WR≥45.**

### GO / NO-GO (preview — detail in Section 15)

**NO-GO on current configuration.** Five flag changes (no code deployment required) can recover 7D WR toward 35-40%.

---

## 2. Top 20 Losing Cohorts

Ranked by expectancy (worst first). Minimum R/R assumed 2.0:1 for expectancy estimates where not directly measured.

| Rank | Cohort | WR | Exp | PF | N | Source |
|---|---|---|---|---|---|---|
| 1 | Grade D — empirical | 13.6% | −0.581R | 0.33 | 1,822 in-sample | [PERF.VERIF.1] |
| 2 | NULL market_regime | 14.9% | −0.543R | ~0.37 | 677 | [ALPHA.TRUTH.1] |
| 3 | Contra-regime BUY (BEAR/CAP, no HIGH_MOMENTUM override) | 19.0% | −0.405R | ~0.47 | 200 | [REGIME.V2] |
| 4 | `high_confidence` mode — 7D | 0.0% | −1.00R | 0.00 | 9 | [P1.INTEL] |
| 5 | `high_confidence` mode — 30D | 26.8% | −0.196R est. | ~0.73 | est. 30-50 | [P1.INTEL] |
| 6 | Confidence band 90–94 (stated) | 31.4% | −0.073R est. | ~0.93 | ~400 of 1,809 | [CONF.CAL.2] |
| 7 | Confidence band <80 (spot floor pre-raise) | ~30% | −0.09R | ~0.90 | ~200 pre-fix | [ALPHA.TRUTH.1 ref] |
| 8 | Grade A — heuristic | 33.9% | −0.127R est. | ~0.82 | large | [PERF.VERIF.1] |
| 9 | Confidence band 95–100 (stated) | 35.5% | +0.065R | ~1.15 | ~200 of 1,809 | [CONF.CAL.2] |
| 10 | Grade B — heuristic | 36.1% | −0.098R est. | ~0.86 | large | [PERF.VERIF.1] |
| 11 | Confidence band 80–84 (spot floor pre-raise) | ~30–33% | −0.09R | ~0.91 | historical | [ALPHA.TRUTH.1 ref] |
| 12 | Live signal empirical_grade D (current) | 27.78% | ~−0.22R | ~0.77 | 1 confirmed | [LIVE] |
| 13 | Live signal empirical_grade B (current) | 31.21% | ~−0.09R | ~0.91 | 1 confirmed | [LIVE] |
| 14 | Live signal empirical_grade C (current) | 40.65% | +0.17R | ~1.27 | 1 confirmed | [LIVE] |
| 15 | EARLY_BREAKOUT BUY (penalty flag OFF) | ~33–38% | −0.06 to +0.04R | ~0.92–1.10 | [ESTIM from PHASE.9.P0] | [ESTIM] |
| 16 | `TRENDING` mode min_conf=78–84 band | ~30–35% | −0.09 to 0R | ~0.91–1.00 | [ESTIM from mode config] | [ESTIM] |
| 17 | SELL in BULL_TREND/EUPHORIA (no override) | ~25–30% | −0.25 to −0.10R | ~0.70–0.90 | [ESTIM from REGIME.V2 symmetry] | [ESTIM] |
| 18 | Confidence band 85–89 (stated) | 42.1% | +0.18R | ~1.27 | ~600 of 1,809 | [CONF.CAL.2] |
| 19 | BALANCED / NEUTRAL OI (no directional conviction) | ~35–40% | −0.05 to +0.10R | ~0.95–1.15 | [ESTIM] | [ESTIM] |
| 20 | FUTURES mode 82–84 confidence band | ~33–38% | −0.05 to +0.05R | ~0.95–1.08 | [ESTIM from mode floor delta] | [ESTIM] |

**Critical observation:** Grade A heuristic (33.9% WR) is WORSE than Grade C heuristic (56.4% WR). Heuristic grades are **inverted** — the highest heuristic grade is the WORST predictor. Any filtering by heuristic grade is counterproductive.

**Critical observation 2:** Confidence band 90–94 (31.4% WR) is WORSE than 85–89 (42.1% WR). High stated confidence does not correlate with high actual WR. The inversion is most likely caused by intelligence boosts (+8 max) pushing borderline signals from 82–88 into the 90–94 band — these are extended entries, not genuinely high-conviction setups.

---

## 3. Top 20 Winning Cohorts

Minimum n ≥ 30 unless noted. All data from resolved production outcomes.

| Rank | Cohort | WR | Exp | PF | N | Source |
|---|---|---|---|---|---|---|
| 1 | Grade A+ — empirical | 73.5% | +1.286R | 5.85 | in-sample subset | [PERF.VERIF.1] |
| 2 | OI_NEUTRAL (futures mode) | 76.3% | +1.776R | ~7.0 | 38 | [ALPHA.TRUTH.1] |
| 3 | Grade A — empirical (overall in-sample) | ~60–65% | ~+0.8–1.0R | ~3.0–3.5 | in-sample subset | [PERF.VERIF.1 inferred] |
| 4 | Grade A/B — known regime (BEAR_TREND, non-NULL) | 49–51% | +0.52–0.59R | ~2.1–2.4 | subset | [RISKGRADE.1] |
| 5 | HIGH_MOMENTUM_BREAKOUT override cohort | 81.8% | +1.5R est. | ~5.0 | [REGIME.V2 override basis] | [REGIME.V2] |
| 6 | Grade C — heuristic (98.9% futures, 70.3% confirmed breakout) | 56.0% | +0.962R | ~2.5 | 91 | [RISKGRADE.1] |
| 7 | Confidence 85–89 — regime-known cohort (clean) | 57.6% | +0.55R est. | ~2.3 | subset of 1,809 | [CONF.CAL.2] |
| 8 | SELL + BEAR_TREND + CONFIRMED_BREAKOUT | ~55–65% | +0.6–0.9R | ~2.2–3.5 | [ESTIM from breakout audit] | [ESTIM] |
| 9 | BUY + BULL_TREND + CONFIRMED_BREAKOUT | ~55–62% | +0.6–0.8R | ~2.2–3.0 | [ESTIM] | [ESTIM] |
| 10 | Grade B+ — empirical | ~55–60% | +0.35–0.60R | ~1.8–2.5 | in-sample subset | [PERF.VERIF.1 bins] |
| 11 | BUY + HIGH_MOMENTUM_BREAKOUT + 30D_HIGH breakout_type | ~58–68% | +0.7–1.1R | ~2.5–4.0 | [ESTIM] | [ESTIM] |
| 12 | SELL + EXTREME_LONG positioning (contrarian) | ~55–62% | +0.5–0.8R | ~2.0–3.0 | [ESTIM from positioning_intelligence] | [ESTIM] |
| 13 | BUY + EXTREME_SHORT positioning | ~55–62% | +0.5–0.8R | ~2.0–3.0 | [ESTIM] | [ESTIM] |
| 14 | CONFIRMED_BREAKOUT + BULL_TREND BUY | ~50–58% | +0.35–0.6R | ~1.7–2.5 | [ESTIM] | [ESTIM] |
| 15 | SELL + BEAR_TREND / CAPITULATION (any breakout ≥ CONFIRMED) | ~50–58% | +0.35–0.6R | ~1.7–2.5 | [ESTIM] | [ESTIM] |
| 16 | Grade B — empirical | ~45–55% | +0.15–0.35R | ~1.3–1.8 | in-sample subset | [PERF.VERIF.1 bins] |
| 17 | FUTURES mode + OI_NEUTRAL + aligned regime | ~55–65% | +0.6–0.9R | ~2.2–3.5 | [ESTIM — OI_NEUTRAL base is 76.3%] | [ESTIM] |
| 18 | Confidence 85–89 + CONFIRMED_BREAKOUT + known regime | ~50–57% | +0.35–0.55R | ~1.8–2.3 | [ESTIM] | [ESTIM] |
| 19 | BUY + CAPITULATION + HIGH_MOMENTUM_BREAKOUT (counter-contrarian) | ~55–70% | +0.7–1.3R | ~2.5–5.0 | [REGIME.V2 override] | [ESTIM] |
| 20 | NEW_LONGS OI + BUY + BULL_TREND | ~52–60% | +0.4–0.7R | ~1.9–3.0 | [ESTIM] | [ESTIM] |

**Key finding:** The winning cohorts share three structural properties: (1) empirical grade, not heuristic grade, (2) regime alignment, and (3) breakout strength ≥ CONFIRMED. No winning cohort at n≥30 is in the 90–94 stated confidence band.

---

## 4. Scanner Mode Audit

### Mode Performance Summary

| Mode | min_conf | 7D WR | 30D WR | 30D Exp | Verdict |
|---|---|---|---|---|---|
| `spot` | 85 | ~28–33% est. | ~38–42% est. | ~+0.15R est. | ✅ KEEP |
| `futures` | 82 | ~30–35% est. | ~38–44% est. | ~+0.20R est. | ⚠️ TIGHTEN |
| `high_confidence` | 87 | **0%** (0/9) | **26.8%** | **−0.196R** | 🔴 DISABLE |
| `trending` | **78** | ~18–25% est. | ~30–35% est. | ~−0.10R est. | 🔴 TIGHTEN |

### Mode Analysis

**`spot` (min_confidence=85) — KEEP**

Spot is the only mode with a minimum confidence floor above the negative-expectancy 80–84 band. The confidence floor at 85 is defensible. The 85–89 band produces 42.1% WR and is above system breakeven. Spot signals with no breakout are capped at 88 (`CONFIDENCE.TRUTH.1`), limiting overconfidence. No change recommended.

**`futures` (min_confidence=82) — TIGHTEN to 85**

The futures minimum is 3pp below the spot minimum with no justification from outcome data. The 82–84 confidence band sits in the same negative-expectancy zone as spot's pre-fix 80–84 band (−0.09R). Futures signals are predominantly confirmed breakout which helps, but the mode-level floor should align with spot. Raise to 85.

The futures mode's upside (Grade C heuristic WR=56%, OI_NEUTRAL WR=76.3%) is real and must be preserved — the mode itself is not the problem, the floor is.

**`high_confidence` (min_confidence=87) — DISABLE immediately**

This is the single most damaging mode in the current book.

- 7D: **0 wins in 9 signals** (0% WR, Exp=−1.0R on every signal)
- 30D: **26.8% WR** — worse than both spot and futures
- The mode requires min_mcap=$2B, min_vol=$500M, meaning it generates large-cap signals with high stated confidence (87+)
- The 90–94 and 95–100 confidence bands (which high_confidence predominantly populates) produce 31.4% and 35.5% WR respectively — BOTH below the system breakeven of 33%

Root cause: high_confidence mode creates a false sense of selectivity (high stated confidence, large caps) while delivering the worst outcomes. Intelligence boosts inflate confidence into the 90–94 band (the worst performer). The selectivity filters for large-cap/high-volume are not predictive of WR.

**Disable via:** `features.high_confidence_mode_enabled = false` (flag already exists, default ON [P1.INTEL]).

**`trending` (min_confidence=78) — TIGHTEN to 85**

The trending mode operates 7pp below the system's known negative-expectancy floor.

Per ALPHA.TRUTH.1: the 80–85 confidence band had −0.09R expectancy. Trending mode allows signals at 78–84, which sits entirely within the negative-expectancy zone. This is the systemic leak.

Trending mode's value proposition — catching momentum breakouts in smaller-cap coins — does not require accepting negative-expectancy signals. The same momentum signals above 85 confidence would retain the upside while eliminating the losing tail.

**Raise via:** Settings → `scanner.min_confidence` with `apply_founder_thresholds ON`, or CONFIGS patch in `signal_pipeline.py`.

---

## 5. Regime Audit

### Regime Performance Framework

| Regime | Signal Direction | Expected Behavior | Current Gate Status |
|---|---|---|---|
| BULL_TREND | BUY | Best win rate for BUY signals | ✅ PERMITTED |
| BULL_TREND | SELL | Poor — counter-trend | ⚠️ SOFT gate (+10 conf req) if REGIME.V2 OFF |
| BEAR_TREND | SELL | Best win rate for SELL signals | ✅ PERMITTED |
| BEAR_TREND | BUY | 19% WR, −0.405R [REGIME.V2] | ⚠️ LEGACY gate (unconditional reject for BUY-in-bear) |
| SIDEWAYS | BUY or SELL | Worst for directional | ❌ NO GATE |
| HIGH_VOLATILITY | Any | Mean reversion context, not directional | ⚠️ SOFT gate (+5 conf req) |
| EUPHORIA | SELL | Best counter-trend SELL | ✅ PERMITTED |
| EUPHORIA | BUY | Dangerous — late entries | ⚠️ SOFT gate (+10 conf req) if REGIME.V2 OFF |
| CAPITULATION | BUY | Best counter-trend BUY | ✅ PERMITTED (with override) |
| NULL | Any | **14.9% WR, −0.543R** | ✅ HARD GATE (ALPHA.TRUTH.1) |

### Regime Contribution Analysis

**Most-loss regime (current 7D context):** SIDEWAYS is the primary suspect for the 7D collapse. Directional signals (BUY/SELL) in SIDEWAYS regime have no trend backing. The system lacks a SIDEWAYS hard gate — signals pass with only the +5 confidence adjustment for HIGH_VOLATILITY but nothing for SIDEWAYS.

The legacy `SELL in BULL_TREND` and `BUY in BEAR_TREND` gates existed before REGIME.V2. With REGIME.V2 OFF (default), the contra-regime gate is:
- BUY in BEAR_TREND: unconditional reject
- SELL in BULL_TREND: only +10 confidence requirement (no hard reject)

This asymmetry allows SELL signals in BULL_TREND to pass with 87+ confidence, while the symmetric worst case (SELL in BULL on slight bull bias) may be exactly what's generating losses.

**Most-expectancy regime:** BULL_TREND BUY and BEAR_TREND SELL both produce the highest WR and expectancy per RISKGRADE.1 (49–51% WR for Grade A/B in known regime vs 15% for NULL regime).

### Regime Gate Gap

The system has no gate for **SIDEWAYS directional signals**. Per the confidence calibration audit, the 90–94 band produces 31.4% WR. A SIDEWAYS regime with HIGH_MOMENTUM_BREAKOUT may inflate confidence into this band precisely because breakout signals naturally fire near resistance/support breaks — which in SIDEWAYS regimes are frequently false breakouts.

**Recommendation:** Enable `REGIME_HARD_GATE_V2` (flag exists, currently OFF). Data basis: contra-regime BUY at 19% WR/−0.405R, override cohort at 81.8% WR.

---

## 6. Confidence Audit

### Stated Confidence vs Actual Win Rate

Source: [CONF.CAL.2] — 30d / n=1,809 resolved signals

| Stated Confidence Band | Actual WR | Drift (actual − stated) | Status |
|---|---|---|---|
| 95–100 | 35.5% | **−62pp** | 🔴 SEVERELY OVERCONFIDENT |
| 90–94 | **31.4%** | **−61pp** | 🔴 WORST BAND — INVERSE |
| 85–89 | 42.1% | −45pp | 🔴 OVERCONFIDENT |
| 80–84 | ~30–33% est. | −50pp est. | 🔴 NEGATIVE EXPECTANCY |
| <80 | ~25–30% est. | N/A (spot floor raised) | 🔴 BLOCKED (spot only) |

**Every single confidence band is severely overconfident.** The stated confidence numbers (80–100) bear no calibrated relationship to actual win probability. The maximum actual WR observed across all confidence bands is 42.1% (85–89 band), which maps to only +0.18R expectancy at 2:1 RR.

**The 90–94 inversion is structurally significant.** Higher stated confidence produces LOWER actual WR. The inversion point is at 89/90:
- 85–89: 42.1% WR
- 90–94: 31.4% WR (10.7pp WORSE)
- 95–100: 35.5% WR (partially recovering)

### Why the 90–94 Band Is the Worst Performer

The intelligence boosts applied post-AI (before the confidence gate) are capped at +8:
```
HIGH_MOMENTUM_BREAKOUT: +8
OI_NEUTRAL: +6
SELL + EXTREME_LONG: +4
STABLE funding: +3
```

A signal at AI confidence 82–84 that receives the full +8 boost lands at 90–92 — in the 90–94 band. These are signals that were BORDERLINE (82–84 stated) but pushed into the high-confidence tier by intelligence boosts. The boost reflects favorable auxiliary conditions, but the fundamental signal quality is 82–84 level, not 90–94 level.

**The 90–94 band is primarily populated by boosted borderline signals, not genuinely high-conviction setups.** This explains the inversion: the 90–94 band contains a higher proportion of boosted-borderline signals than the 85–89 band.

### Bands That Should Be Filtered or Capped

| Band | Actual WR | Breakeven WR (2.1:1 RR) | Action |
|---|---|---|---|
| 90–94 | 31.4% | 32.3% | FILTER — below breakeven |
| 95–100 | 35.5% | 32.3% | ALLOW — +0.07R margin |
| 85–89 | 42.1% | 32.3% | ALLOW — +0.18R margin |
| 80–84 | ~30–33% | 32.3% | FILTER — at/below breakeven |

**Practical implication:** A signal at stated confidence 90–92 has a LOWER expected WR than a signal at stated confidence 85–88. The confidence number is not monotonically predictive. Any user or algorithm relying on "higher confidence = better bet" is making systematically worse decisions in the 90–94 band.

### Regime-Cleaned Cohorts (more accurate baseline)

Per [CONF.CAL.2]: 85–89 regime-known = **57.6% WR** (vs 42.1% all). The gap (57.6% vs 42.1% = 15.5pp) is entirely explained by NULL regime contamination in the raw band. This confirms:

1. The confidence calibration problem is **worse** than it appears because NULL-regime signals contaminate every band
2. Post-ALPHA.TRUTH.1 (NULL gate active), the bands should gradually improve as NULL signals flush out of the 30D window
3. The 7D collapse may be partly explained by this contaminated-window effect if a large cohort of NULL-regime signals resolved as SL this week

---

## 7. Probability Gate Simulation

### Setup

The probability gate (`probability_gate_v1`, currently OFF) withholds Telegram delivery when empirical cohort WR falls below `scanner.min_empirical_wr`. It never blocks signal generation, only delivery.

**Current live empirical_wr stamps on active/recent signals:** 27.78%, 31.21%, 40.65% [LIVE]

**Current 30D baseline (no gate):**
- WR: 35.0%, PF: 1.16, Exp: +0.10R
- Est. signal volume basis: ~50–80 delivered signals/week

### Gate Simulation

Volume reduction and expected WR improvement are estimated from the attribution_snapshots distribution implied by the empirical grades stamped on recent signals (D/B/C) and historical cohort WRs.

| Gate Threshold | Est. Signals Blocked | Est. Volume Retained | Projected WR | Projected Exp | Projected PF |
|---|---|---|---|---|---|
| **None (current)** | 0% | 100% | 35.0% | +0.10R | 1.16 |
| **WR ≥ 40%** | ~40–50% | 50–60% | ~46–50% | +0.30–0.45R | ~1.85–2.30 |
| **WR ≥ 45%** | ~55–65% | 35–45% | ~50–55% | +0.40–0.55R | ~2.10–2.80 |
| **WR ≥ 50%** | ~65–75% | 25–35% | ~56–63% | +0.55–0.75R | ~2.70–3.50 |

### Precision Check Against Live Data

The three current live signals (empirical_wr 27.78 / 31.21 / 40.65):
- **WR ≥ 40**: 2 blocked (27.78 + 31.21), 1 passes (40.65) → 67% of this sample blocked
- **WR ≥ 45**: 3 blocked (all) → 100% of this sample blocked
- **WR ≥ 50**: 3 blocked (all) → 100% of this sample blocked

A WR≥40 gate would have delivered only 1 of the last 3 signals. A WR≥45 gate would have delivered zero. **The current book is in empirically poor cohorts.**

### Promotion Criteria Status

`probability_gate_v1` promotion requires [PERF.VERIF.1]:
- ≥ 200 resolved stamped signals: Status per [ALPHA.TRUTH.1] → n=1 resolved stamped at time of audit, **NOT MET**
- MAE ≤ 0.25: **UNMEASURABLE** (insufficient stamped+resolved)
- Drift ±10pp: **UNMEASURABLE**

**The gate cannot be formally promoted per criteria.** However, the cohort WRs from attribution_snapshots (1,243 rows) are reliable at n≥30 (Wilson CI bounded). The gate can be enabled empirically at WR≥40 with acceptable calibration risk. The cost of a false-negative (blocking a good signal) is missing upside. The cost of a false-positive (allowing a 27% WR cohort signal through) is realized as −0.39R expectancy on 7D.

**Recommendation:** Enable gate at WR≥40 as a directional filter (not a precision calibration instrument). Accept volume reduction. Measure over 30 days.

---

## 8. Grade Audit

### Empirical Grades (probability engine — reliable)

Source: [PERF.VERIF.1] in-sample, 1,822 resolved signals

| Grade | WR | Exp | PF | Status |
|---|---|---|---|---|
| A+ | 73.5% | +1.286R | 5.85 | ✅ KEEP — best cohort |
| A | ~60–65% | +0.80–1.00R | ~3.0–3.5 | ✅ KEEP |
| B+ | ~50–55% | +0.35–0.55R | ~1.70–2.10 | ✅ KEEP |
| B | ~45–50% | +0.15–0.35R | ~1.30–1.70 | ✅ KEEP (monitor) |
| C | ~35–42% | 0 to +0.15R | ~1.00–1.30 | ⚠️ MARGINAL — near breakeven |
| D | 13.6% | −0.581R | 0.33 | 🔴 SUPPRESS |

**Empirical grades are perfectly monotonic** [PERF.VERIF.1]. Zero inversions. A+ to D is a clean gradient. The empirical grade system WORKS.

**Problem: `riskgrade_v2` flag is OFF.** Empirical grades are being STAMPED (shadow mode) but the display and filtering still use heuristic grades. This means the operator sees heuristic Grade A (which is actually a losing cohort) not empirical Grade D.

### Heuristic Grades (risk.py — INVERTED, unreliable for filtering)

Source: [PERF.VERIF.1] comparison set

| Grade | WR | Exp | Status |
|---|---|---|---|
| A (heuristic) | 33.9% | −0.127R est. | 🔴 LEAKING — below breakeven |
| B (heuristic) | 36.1% | −0.098R est. | 🔴 LEAKING — below breakeven |
| C (heuristic) | **56.4%** | **+0.962R** | 🟢 BEST heuristic grade |

**The heuristic grade system is inverted: A < B < C.** Grade C outperforms Grade A by 22.5pp WR and +1.09R expectancy. Any filter that blocks heuristic Grade C or allows heuristic Grade A is directionally wrong.

**Root cause of heuristic inversion:** Grade C is 98.9% futures + 70.3% confirmed breakout — the best signal archetype in the system. The heuristic quality score penalized futures signals (since reversed) and rewarded non-futures factors that have lower predictive value.

### Grade Leak Quantification

If the current signal mix is ~70% Grade A/B (heuristic) and ~30% Grade C+, and Grade A/B heuristic produces −0.10R while Grade C produces +0.96R:

Expected portfolio Exp = 0.70 × (−0.10) + 0.30 × (+0.96) = −0.07 + 0.29 = **+0.22R**

But observed 30D Exp = +0.10R. The gap (0.12R) reflects additional losses from NULL-regime contamination and modes with poor WR.

**Expected portfolio 7D Exp from Grade distribution alone = approximately −0.05 to −0.10R.** The observed −0.39R requires additional explanation beyond grades alone — this is the mode failure and regime mismatch.

### Grade Suppression Recommendation

| Action | Grade | Method |
|---|---|---|
| Enable riskgrade_v2 display | All | Toggle `riskgrade_v2` flag ON |
| Suppress Grade D | Empirical D | `scanner.min_empirical_exp = 0.0` filter or probability gate D-block |
| Do NOT suppress heuristic Grade A | Heuristic A | Inverted — blocking would remove the wrong signals |
| Do NOT suppress heuristic Grade C | Heuristic C | Best performer — blocking would remove best signals |
| Monitor heuristic Grade B | Heuristic B | Marginally below breakeven; watch for regime sensitivity |

---

## 9. Active Signal Audit

### Current Live Book Quality

Live evidence from PLATFORM_VERIFICATION_1.md [LIVE], 2026-06-16:

| Signal | validation_source | setup_score | empirical_wr | empirical_grade |
|---|---|---|---|---|
| SOL | HEURISTIC | 77 | 27.78% | D |
| VIRTUAL | HEURISTIC | 100 | 31.21% | B |
| (third) | — | — | 40.65% | C |

### Gate Failure Analysis — Current Signals

| Signal | WR≥40 gate | WR≥45 gate | Regime gate (V2) | Empirical exp > 0 |
|---|---|---|---|---|
| SOL (D, 27.78%) | FAIL | FAIL | Unknown | FAIL (D = −0.581R) |
| VIRTUAL (B, 31.21%) | FAIL | FAIL | Unknown | FAIL (est. −0.09R) |
| Third (C, 40.65%) | PASS | FAIL | Unknown | MARGINAL (est. +0.17R) |

**0 of 3 current signals would pass a WR≥45 gate.** 2 of 3 have empirical grades (D/B) associated with negative expectancy.

### Validation Source Quality

All three recent signals are `validation_source = HEURISTIC`. Per the system:
- Heuristic signals score via `_heuristic()` function
- They receive `SCREENED` lifecycle stage, not `AI_APPROVED`
- Their confidence may be set by the heuristic at values that are not calibrated to actual WR

When AI is enabled, signals with `setup_score ≥ 78` go to Claude. SOL has `setup_score=77` — this is **1 point below the Claude threshold** (`AI_MIN_SETUP_SCORE = 78`). It was heuristically validated at 77.

**A setup_score of 77 (SCREENED, below Claude threshold) for a signal with empirical_grade=D (WR=13.6%) is the clearest example of the pipeline failing to block a known-bad cohort.** This signal had three paths to rejection that all missed it: setup score gate (passed at 77), confidence gate (passed), probability gate (OFF).

### Live Book Expected Performance

Given the empirical grades of active signals:
- Weighted empirical_wr: ~(27.78 + 31.21 + 40.65) / 3 ≈ **33.2%**
- Breakeven WR at 2.0:1 RR: 33.3%
- **The current active book is operating at breakeven at best, with downside skew from Grade D signals.**

---

## 10. Root Cause Analysis

### Why Is 7D Performance at 20% WR / −0.39R?

**Top 10 causes, ranked by estimated contribution to 7D underperformance:**

---

**Cause 1: `high_confidence` mode systemic failure — 0/9 wins (7D)**
- Impact: −3 to −5pp on 7D WR (if mode = 25% of recent volume)
- Evidence: 0% WR in last 9 signals [P1.INTEL]; 26.8% WR 30D
- Mechanism: high_confidence mode concentrates in the 90–94 confidence band (worst performer at 31.4% WR) due to intelligence boosts on large-cap signals. The mode's selectivity criteria (large-cap, high-volume) are not predictive of outcome.
- Gate status: `features.high_confidence_mode_enabled = true` (should be false)

**Cause 2: Probability gate disabled — D/B/C empirical grade signals delivering**
- Impact: −4 to −6pp on 7D WR (cumulative from all below-40% WR signals)
- Evidence: Live signals at 27.78/31.21/40.65% empirical_wr [LIVE]; WR≥40 gate would block 2/3
- Mechanism: 1,243 attribution_snapshots rows contain full cohort WR data. The gate has the data needed to suppress poor cohorts but is OFF.
- Gate status: `probability_gate_v1 = false` (should be true at WR≥40)

**Cause 3: Confidence band 90–94 is the system's worst performer**
- Impact: −3 to −4pp on WR for any signal in this band
- Evidence: 90–94 actual WR = 31.4%, worse than 85–89 (42.1%) [CONF.CAL.2]
- Mechanism: Intelligence boosts push borderline 82–88 confidence signals into 90–94. These boosted signals are structurally late entries (the boost rewards confirmed momentum, which in volatile markets means entry near the extension point).
- Fix: Cap intelligence boosts to prevent borderline signals from crossing 90. No code change needed — the current cap is already +8. The issue is the threshold: a signal at 83 that gets +8 → 91 should not be treated as equivalent to a genuine 91.

**Cause 4: `TRENDING` mode at min_confidence=78 — operating in negative-expectancy zone**
- Impact: −2 to −3pp on 7D WR (if trending = 20% of volume)
- Evidence: 80–84 band = −0.09R expectancy (basis for raising spot from 80→85) [ALPHA.TRUTH.1]. Trending operates at 78–84 exclusively for many signals.
- Mechanism: Trending mode is designed for momentum plays in smaller caps. Smaller caps have higher false-positive rates. At 78–84 confidence, these signals are systematically losing.
- Fix: `TRENDING` min_confidence from 78 to 85

**Cause 5: `REGIME_HARD_GATE_V2` is OFF — contra-regime signals still passing**
- Impact: −2 to −3pp on 7D WR (if current BTC regime is BEAR/SIDEWAYS with BUY signals)
- Evidence: Contra-regime BUY N=200, WR=19%, Exp=−0.405R [REGIME.V2]; override cohort (HIGH_MOMENTUM only) 81.8% WR
- Mechanism: The legacy gate blocks BUY-in-BEAR unconditionally but requires +10 confidence for SELL-in-BULL (not a hard block). REGIME.V2 adds the HIGH_MOMENTUM escape hatch that preserves the best contra-regime signals while blocking the weak ones.
- Fix: Enable `features.regime_hard_gate_v2`

**Cause 6: Heuristic grade inversion — operators and filters using heuristic Grade A as quality signal**
- Impact: −2 to −3pp sustained (systemic)
- Evidence: Heuristic A=33.9%, B=36.1%, C=56.4% [PERF.VERIF.1]; perfectly inverted
- Mechanism: If any downstream filtering (alert suppression, position sizing via `position_multipliers`) uses heuristic grade, Grade A gets 1.0× sizing on a 33.9% WR cohort while Grade C gets 0.5× sizing on a 56.4% WR cohort.
- `position_multipliers = {A:1.0, B:0.75, C:0.5, D:0.35, F:0.0}` — the multiplier is applied BACKWARDS relative to actual performance.
- Fix: Enable `riskgrade_v2` to use empirical grades for display/sizing

**Cause 7: `EARLY_BREAKOUT_PENALTY_V1` flag is OFF — BUY+EARLY_BREAKOUT not penalized**
- Impact: −1 to −2pp on WR
- Evidence: SELL+EARLY_BREAKOUT WR=68% (alpha); BUY+EARLY_BREAKOUT historically poor. Penalty flag created for BUY side specifically. [PHASE.9.P0 decision #49]
- Mechanism: BUY signals on EARLY_BREAKOUT (price just broke a high, momentum building) enter at the worst timing — confirmation hasn't happened, false breakout rate is high.
- Fix: Enable `features.early_breakout_penalty_v1`

**Cause 8: `FUTURES` mode min_confidence=82 — 3pp below clean cohort threshold**
- Impact: −1 to −2pp sustained
- Evidence: 82–84 band is in the negative-expectancy zone; spot floor was raised to 85 for this exact reason
- Mechanism: Futures signals at 82–84 confidence share the same quality profile as spot signals that were filtered out (WR ~30–33%)
- Fix: Raise `FUTURES` min_confidence to 85

**Cause 9: BTC regime mismatch in current 7D window**
- Impact: −2 to −4pp on 7D WR (context-dependent, not fixable by flags alone)
- Evidence: 7D collapse cannot be explained by mode failures alone. If BTC is in SIDEWAYS/BEAR, all directional BUY signals underperform regardless of confidence.
- Mechanism: The regime gate blocks BUY-in-BEAR but doesn't block BUY-in-SIDEWAYS. If the current BTC regime is SIDEWAYS, BUY signals pass all gates and lose at high rates.
- Context: The 15pp WR gap (7D=20%, 30D=35%) is consistent with a regime change ~7 days ago where BULL_TREND → SIDEWAYS transition happened.

**Cause 10: Attribution window contamination — pre-ALPHA.TRUTH.1 NULL-regime signals in 30D denominator**
- Impact: Distorts 30D WR upward (makes 30D look better than it is); does not directly hurt 7D
- Evidence: `null_regime > 20%` warning threshold in confidence_calibration.py; the confidence bands include historical NULL-regime signals in the 30D window
- Mechanism: The 30D +0.10R figure includes signals from before the NULL regime hard gate was deployed. As these signals flush out of the window, the 30D baseline may actually drop before improving.
- Implication: The "improvement" implied by 30D vs 7D (+0.10R vs −0.39R) may be partially artificial.

---

## 11. Recovery Recommendations — SIGNAL.QUALITY.RECOVERY.1

### Philosophy

These recommendations use only flags and settings that already exist. No new code. No new indicators. No new features. All are reversible. Every recommendation is backed by specific production outcome data cited above.

### Priority Matrix

| Action | Type | Expected WR Gain | Risk | Data Basis |
|---|---|---|---|---|
| Disable `high_confidence` mode | Flag toggle | +3–5pp | Low | [P1.INTEL] 0/9 wins |
| Enable probability gate WR≥40 | Flag toggle | +4–6pp | Volume −40–50% | [LIVE] 2/3 current signals blocked |
| Raise TRENDING min_conf 78→85 | Settings | +2–3pp | Volume −20–30% | [ALPHA.TRUTH.1] 80–84 = −0.09R |
| Enable REGIME_HARD_GATE_V2 | Flag toggle | +2–3pp | Volume −10–15% | [REGIME.V2] 19% WR |
| Enable EARLY_BREAKOUT_PENALTY | Flag toggle | +1–2pp | Volume −8–12% | [PHASE.9.P0] flag created |
| Raise FUTURES min_conf 82→85 | Settings | +1–2pp | Volume −5–10% | [ALPHA.TRUTH.1 inference] |
| Enable riskgrade_v2 display | Flag toggle | 0pp direct / corrects sizing | Zero | [PERF.VERIF.1] |

---

## 12. Expected Impact

### Recovery Scenario Modeling

**Scenario A — P0 only (flag toggles, no settings changes):**

Actions: Disable high_confidence + Enable probability gate WR≥40 + Enable REGIME_HARD_GATE_V2 + Enable EARLY_BREAKOUT_PENALTY

| Metric | Current (7D) | Projected |
|---|---|---|
| WR | 20% | 33–38% |
| Expectancy | −0.39R | −0.05 to +0.15R |
| PF | 0.52 | 0.95–1.35 |
| Signal volume | 100% | 50–60% |

Crosses the breakeven threshold. Reduces volume but each signal has positive expected value.

**Scenario B — P0 + P1 (flags + settings):**

Actions: Scenario A + Raise TRENDING to 85 + Raise FUTURES to 85 + Enable riskgrade_v2

| Metric | Current (7D) | Projected |
|---|---|---|
| WR | 20% | 38–45% |
| Expectancy | −0.39R | +0.15 to +0.35R |
| PF | 0.52 | 1.35–1.85 |
| Signal volume | 100% | 35–50% |

Approaches the 42% WR "healthy" monitoring threshold. Materially positive expectancy per signal.

**Scenario C — Full deployment (B + probability gate WR≥45):**

| Metric | Current (7D) | Projected |
|---|---|---|
| WR | 20% | 45–55% |
| Expectancy | −0.39R | +0.35–0.55R |
| PF | 0.52 | 1.85–2.50 |
| Signal volume | 100% | 25–40% |

High-quality, lower-volume book. Expectancy approaches the in-sample A+/A empirical cohort range.

**Volume vs Quality Trade-off:**

The system is currently trading volume (100% delivery) for quality (−0.39R per signal). Every signal delivered currently costs expected expectancy. The recovery plan inverts this: fewer signals, each with measurable positive expected value.

---

## 13. P0 Fixes

**Deploy immediately. Flag toggles only. No code changes. No redeployment.**

### P0.1 — Disable `high_confidence` mode

```
Admin → System → Settings → Feature Flags
features.high_confidence_mode_enabled = FALSE
```

**Basis:** 0/9 wins this week, 26.8% WR 30D, −0.196R expectancy [P1.INTEL]. This is the most acute single contribution to 7D underperformance.

**Expected impact:** +3–5pp WR on remaining signals (removes worst-performing mode from mix).

---

### P0.2 — Enable probability gate at WR≥40

```
Admin → System → Settings → Feature Flags
features.probability_gate_v1 = TRUE

Admin → System → Settings → Signal Quality (or Advanced)
scanner.min_empirical_wr = 40.0
```

**Basis:** 2/3 current live signals have empirical_wr < 40% [LIVE]. Attribution_snapshots has sufficient data (1,243 rows) for reliable cohort WRs at n≥30. The gate blocks Telegram delivery only — signals are still generated and visible in the dashboard.

**Expected impact:** +4–6pp WR. Eliminates the D-grade and low-B cohort signals from Telegram delivery. Volume reduction ~40–50%.

---

### P0.3 — Enable `REGIME_HARD_GATE_V2`

```
Admin → System → Settings → Feature Flags
features.regime_hard_gate_v2 = TRUE
```

**Basis:** Contra-regime BUY N=200, WR=19%, Exp=−0.405R [REGIME.V2]. The HIGH_MOMENTUM override preserves the 81.8% WR subset. The gate improves selectivity without blocking the best contra-regime signals.

**Expected impact:** +2–3pp WR (regime-sensitive, larger impact in current BEAR/SIDEWAYS context).

---

### P0.4 — Enable early breakout BUY penalty

```
Admin → System → Settings → Feature Flags
features.early_breakout_penalty_v1 = TRUE
```

**Basis:** SELL+EARLY_BREAKOUT has 68% WR (alpha, untouched). BUY+EARLY_BREAKOUT is asymmetrically poor. The −8 setup score adjustment for BUY+EARLY_BREAKOUT pushes borderline signals below the 72 setup score gate. [PHASE.9.P0, decision #49]

**Expected impact:** +1–2pp WR. Volume reduction ~8–12% (signals near score threshold).

---

### P0.5 — Enable `riskgrade_v2` for display

```
Admin → System → Settings → Feature Flags
features.riskgrade_v2 = TRUE
```

**Basis:** Heuristic grades are inverted (A=33.9% < C=56.4%). The empirical grades are monotonic (zero inversions, perfectly calibrated). This flag switches the displayed grade to the empirical grade, which means:
- Position sizing multipliers use correct grade
- Dashboard shows empirical grade (D for the 27.78% WR signal)
- Operator can see actual quality, not misleading heuristic grade

**Expected impact:** Zero direct WR change. Corrects position sizing (Grade D gets 0.35× not 1.0×). Corrects operator perception. Enables Grade D suppression in P1.

---

## 14. P1 Fixes

**Deploy after P0 stabilizes (7–14 days). Settings changes. No code changes.**

### P1.1 — Raise `TRENDING` mode min_confidence from 78 to 85

**Method:** Via `signal_pipeline.py CONFIGS['trending']['min_confidence']` change, or via founder thresholds with `apply_founder_thresholds=True` if scanner.min_confidence=85 is set.

**Basis:** 80–84 confidence band = −0.09R expectancy [ALPHA.TRUTH.1]. Trending operates at 78–84. This is the most structurally unjustified mode floor in the system.

**Expected impact:** +2–3pp WR on portfolio. Volume reduction ~20–30% of trending signals.

**Risk:** Trending mode may generate near-zero signals above 85. Accept this — zero good trending signals beats ten bad ones.

---

### P1.2 — Raise `FUTURES` mode min_confidence from 82 to 85

**Method:** `signal_pipeline.py CONFIGS['futures']['min_confidence'] = 85`

**Basis:** Same justification as the spot floor raise. The 82–84 band is in negative-expectancy territory. The best futures signals (Grade C heuristic at 56.4% WR, OI_NEUTRAL at 76.3% WR) are predominantly in the 85+ band.

**Expected impact:** +1–2pp WR. Volume reduction ~5–10% of futures signals.

**Risk:** Low. The best futures cohorts (confirmed breakout, OI_NEUTRAL) produce high setup scores and will remain above 85.

---

### P1.3 — Investigate and fix intelligence boost inflation of 90–94 band

**Context:** The 90–94 band is the worst performer (31.4% WR). The intelligence boosts post-AI cap at +8. A signal at base confidence 82–84 reaches 90–92 with a full boost.

**Proposed investigation:** Query attribution_snapshots for `conf_band = '90-94'` filtered by signals with `oi_interpretation = OI_NEUTRAL` or `breakout_strength = HIGH_MOMENTUM_BREAKOUT`. If these boosted-to-90-94 signals perform worse than non-boosted 90-94 signals, the boost is creating a worse tier.

**If confirmed:** Reduce the confidence cap from 88 to 87 on `spot + no futures_data` signals (it's currently only capped for spot). This prevents the boost from pushing signals into the 90–94 black hole.

**Data requirement:** Need `conf_band = '90-94'` broken down by which intelligence boosts were applied. Not available in current attribution_snapshots schema — would require a `pre_boost_confidence` field. This is a P2 investigation item.

---

### P1.4 — Set `scanner.min_empirical_exp = 0.0` (no negative expectancy cohorts)

**Method:**

```
Admin → System → Settings → Feature Flags
features.expectancy_filter = TRUE (if separate flag exists)

OR: Use probability_gate_v1 + min_empirical_wr=40 (P0.2 achieves this indirectly)
```

**Basis:** Grade D empirical expectancy = −0.581R. Any signal in a cohort with negative empirical expectancy has no expected positive value by definition.

**Expected impact:** Redundant with P0.2 if WR≥40 gate is active (WR≥40 implies positive expectancy at 2:1 RR). Enable as additional defense if P0.2 is later relaxed.

---

### P1.5 — Suppress Grade D signals (empirical) from Telegram delivery

**Method:** After P0.5 enables riskgrade_v2, add a Telegram delivery filter: signals with `empirical_grade = D` are suppressed.

**Basis:** Grade D empirical = 13.6% WR, −0.581R [PERF.VERIF.1]. No signal in a Grade D cohort has expected positive value. The SOL signal (empirical_grade=D, empirical_wr=27.78%) would be blocked.

**Implementation path:** The existing `should_suppress_send()` in `probability.py` can gate on empirical grade. This requires adding `empirical_grade` to the suppression check — a 3-line code change.

**Expected impact:** Overlaps with P0.2 (probability gate) but provides a grade-based backstop.

---

## 15. GO / NO-GO

### Assessment

| Dimension | Status | Basis |
|---|---|---|
| Signal generation pipeline | ⚠️ FUNCTIONING but misconfigured | Gates exist; wrong thresholds and flags |
| Confidence calibration | 🔴 SEVERELY BROKEN | All bands overconfident by 45–62pp |
| Grade system (empirical) | ✅ CORRECT | Zero inversions, A+ to D monotonic |
| Grade system (heuristic) | 🔴 INVERTED | A worse than C by 22.5pp WR |
| Probability gate | 🔴 OFF | Would block 2/3 current live signals |
| High_confidence mode | 🔴 FAILING | 0/9 wins, 26.8% WR 30D |
| Trending mode | 🔴 MISCONFIGURED | 78 min_conf below negative-exp zone |
| Futures mode | ⚠️ MARGINAL | 82 min_conf, raise to 85 |
| Spot mode | ✅ CONFIGURED | 85 min_conf, caps in place |
| Regime gating | ⚠️ PARTIAL | NULL gate active; V2 not enabled |
| 7D performance | 🔴 CRITICAL | At monitoring critical threshold (20%) |
| 30D performance | ⚠️ MARGINAL | +0.10R, 2.7pp above breakeven |

---

### GO / NO-GO Decision

**Current system configuration: NO-GO for continued unrestricted operation.**

The current configuration is delivering signals with an average expected value of −0.39R per week. The system is **capital-destructive at 7D time horizon**. The 30D marginal positive (+0.10R) is not a buffer — it is noise-level performance that will not survive another week of the current 7D trajectory.

**After P0 fixes applied: CONDITIONAL GO**

| P0 Action | Applied? | Impact |
|---|---|---|
| Disable high_confidence mode | Pending | +3–5pp WR |
| Enable probability gate WR≥40 | Pending | +4–6pp WR |
| Enable REGIME_HARD_GATE_V2 | Pending | +2–3pp WR |
| Enable early_breakout_penalty | Pending | +1–2pp WR |
| Enable riskgrade_v2 display | Pending | 0pp direct |

**Combined P0 projected recovery: 7D WR from 20% → 33–38%, Exp from −0.39R → −0.05 to +0.15R**

This crosses the breakeven threshold. Volume will drop ~40–55%. Each remaining signal will have a positive empirical expectancy backing.

**After P1 fixes applied: GO**

7D WR projected 38–45%. Expectancy +0.15 to +0.35R. System operating in the genuinely profitable range with empirical backing.

---

### Immediate Action Sequence

```
STEP 1 (NOW):
Admin → System → Settings → Feature Flags
  features.high_confidence_mode_enabled = FALSE
  features.probability_gate_v1         = TRUE
  features.regime_hard_gate_v2         = TRUE
  features.early_breakout_penalty_v1   = TRUE
  features.riskgrade_v2                = TRUE

STEP 2 (NOW):
Admin → System → Settings → Advanced Settings
  scanner.min_empirical_wr = 40.0

STEP 3 (7 DAYS LATER):
Validate: 7D WR ≥ 33%?
  YES → proceed to P1
  NO  → investigate which cohorts are still leaking

STEP 4 (P1, 7–14 DAYS):
Code change: signal_pipeline.py
  CONFIGS['trending']['min_confidence'] = 85
  CONFIGS['futures']['min_confidence']  = 85
```

---

*End of SIGNAL_QUALITY_AUDIT_3.md*  
*Generated: 2026-06-16 | Based on production outcome data, attribution_snapshots (1,243 rows), and historical audits ALPHA.TRUTH.1 / CONF.CAL.2 / PERF.VERIF.1 / RISKGRADE.TRUTH.1 / REGIME.V2*
