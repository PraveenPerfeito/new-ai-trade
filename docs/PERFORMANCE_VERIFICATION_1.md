# PERFORMANCE.VERIFICATION.1

**Date:** 2026-06-12 · **Nature:** analytics only — no scanner changes, no filtering, no gating. Live verification executed against production data; dashboard ships in Analytics → Probability.

## 1. Accuracy Metrics (probability predictions vs reality)

**Out-of-sample (stamped predictions joined to resolved outcomes): n = 1.** The single resolved stamped signal (XMR BUY, SIDEWAYS): predicted 30.3% → lost. Directionally consistent, statistically meaningless. Stamping began 2026-06-11; accumulation continues automatically. **Target before any promotion: 200 resolved stamped signals.** The dashboard's Probability Accuracy panel tracks predicted/actual/drift/MAE per regime, grade, breakout, type, and mode, each cell with calibration check (prediction inside the realized Wilson CI) and low-sample flags.

## 2. Stability Metrics (Edge Matrix across windows)

| Comparison | Jaccard | Top-3 retained | Honest reading |
|---|---|---|---|
| 7d vs 30d | 0.20 | 0/3 | **Regime-driven, not cohort decay**: last 7d is 96% SIDEWAYS (114/119 outcomes) vs a BEAR_TREND-dominated 30d. Cohort rankings are regime-conditional *by design* — the engine keys on regime precisely because of this. |
| 30d vs 90d | 1.00 | 3/3 | **Trivial** — outcome history only extends ~30 days, so the windows contain identical data. Becomes meaningful from mid-July. |

The d7 window's only two qualifying cohorts are both SIDEWAYS SELLs at **−0.42R / −0.53R** — i.e., the live probability gate (WR≥45) is suppressing exactly the cohorts currently losing money this week.

## 3. Grade Validation

**Empirical grades (derived via the current engine over 30d, n=1,822) — ZERO inversions, perfectly monotonic on both WR and expectancy:**

| Grade | n | WR | Exp | PF |
|---|---|---|---|---|
| A+ | 83 | 73.5% | +1.286R | 5.85 |
| A | 709 | 58.0% | +0.829R | 2.97 |
| B+ | 54 | 44.4% | +0.370R | 1.67 |
| B | 102 | 41.2% | +0.260R | 1.44 |
| D | 874 | 13.6% | −0.581R | 0.33 |

**Heuristic A–F (same outcomes) — 2 inversions detected:** A 33.9% < B 36.1% < C 56.4%.

Caveat stated plainly: the empirical table is **partially circular** (grades bin the expectancy of the same cohorts being measured), so perfection is expected on exp; the non-trivial results are (a) WR ordering also holds, (b) the bins separate cleanly with large gaps, (c) the heuristic system fails the identical test on the identical data. The decisive test is **stamped** grades vs *future* outcomes — accumulating now (graded_total resets from this deploy).

## 4. Edge Validation

Top-30d cohorts with CI (from the live Edge Matrix): BEAR|SELL|HIGH_MOMENTUM 81.8% (n=33) · BEAR|SELL|EARLY 68.0% (n=50) · BEAR|SELL|NULL 63.8% (n=141) · BEAR|SELL|CONFIRMED 56.5% (n=568). Bottom: BEAR|BUY|EARLY 11.3% (n=53) · SIDEWAYS|SELL|NULL 17.8% (n=73). Sample-quality and CI columns render on every row; cohorts under n=20 are excluded from ranking entirely.

## 5. Probability Validation

In-sample reliability is established (the 30d simulation: gated cohort realized 59.6% vs predicted ≥45 floor). Out-of-sample reliability is **unproven at n=1** — explicitly not claimable yet. The verification dashboard makes this impossible to misread: every accuracy panel carries n, CI, and low-sample warnings.

## 6. Promotion Criteria — `probability_gate_v1` (expectancy filter)

Promote ON only when ALL hold:
1. ≥ 200 resolved stamped signals;
2. overall mean-abs-error ≤ 0.25 and overall drift within ±10pp;
3. every n≥30 accuracy cell calibrated (prediction inside realized CI) or explainably regime-shifted;
4. at least one live cohort exists with WR ≥ 45 but expectancy < `min_empirical_exp` — otherwise the filter has no work to do and stays a dormant safety net.

## 7. Promotion Criteria — `riskgrade_v2` (display-primary empirical grades)

Promote ON only when ALL hold:
1. ≥ 30 resolved **stamped** (out-of-sample) signals in each of ≥3 grade buckets;
2. zero WR and exp inversions on the stamped-grade table;
3. A+/A stamped cohorts outperform the global baseline by ≥ +0.3R;
4. heuristic grade remains visible as secondary (already guaranteed by design).

## 8. GO / NO-GO

**GO** on the verification infrastructure (shipped, read-only, self-updating) and on continued shadow accumulation. **NO-GO today on both flag promotions** — sample-quality gates unmet (1 resolved stamped signal; 0 stamped grades). The in-sample evidence (monotonic grades, 59.6%-WR gated cohort, regime-conditional stability behaving as designed) says the architecture is right; the out-of-sample counters now tick automatically and the dashboard will show green when the criteria in §6–7 are met. Re-run this verification at ~200 resolved stamped signals (estimate: 2–4 weeks at current generation rates).
