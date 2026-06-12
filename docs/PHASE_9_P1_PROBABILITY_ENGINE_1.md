# PHASE.9.P1.PROBABILITY.ENGINE.1

**Date:** 2026-06-12 · **Foundation:** attribution_snapshots (P0) + confidence_calibration (read-only) — no new infrastructure, no ML, SQL aggregation only. **All behavior changes flag-gated OFF.**

## 1. Executive Summary

Confidence stays visible; **outcome-derived probability becomes primary**. The ProbabilityEngine resolves every signal to its most specific historical cohort (n≥30) and returns probability-of-win, expectancy, profit factor, sample size, and a Wilson 95% CI. The 30-day simulation: gating delivery at cohort WR ≥ 45 keeps 43.5% of volume at **WR 59.6% (+23.5pp), expectancy +0.877R (6.9×), PF 3.17** — the single largest measurable profitability lever in the platform.

## 2. Probability Engine Design (Phase A)

`backend/analytics/probability.py` — `evaluate(lookup, market_regime, signal_type, breakout_strength, confidence)` → `CohortStats{wr, exp, pf, n, level, ci_low, ci_high}`.
- **5-level hierarchy** (most specific first, each requiring n≥30): `regime|type|breakout` → `regime|type` → `regime` → `conf_band` → `global`.
- Source: latest `attribution_snapshots` generation (30d window), hourly in-process cache. New snapshot dims added: `global`, `trend_tier|breakout`, `sector|funding`, `oi|positioning` (23 dimension sets total). Snapshots re-seeded — new dims live now.
- Wilson interval: pure math (`wilson_interval(wr, n)`); e.g. the BEAR×SELL cohort (59.6%, n=792) carries CI [56.2–63.0].
- Backward-compatible: `lookup_empirical()` wrapper retained; existing gate path untouched.

## 3. Signal Score Evolution (Phase B)

Nothing removed. Every accepted signal is stamped `empirical_wr` + `empirical_n` (live since P0) and now `empirical_grade`. Dashboards show **"P 61%" chips next to confidence** in Signals + Tactical rows (color: ≥55 green / ≥45 blue / <45 red), tooltip explains primacy. `rowToSignal` maps the columns; pre-migration rows show nothing.

## 4. RiskGrade 2.0 Design (Phase C)

Grade from outcome history: cohort expectancy binned — **A+ ≥1.0R · A ≥0.6 · B+ ≥0.35 · B ≥0.15 · C ≥0 · D <0**, ungraded when n<30. Stamped as shadow data on every signal (`empirical_grade`); heuristic A–F (`risk_grade`) is untouched and still computed. Flag `riskgrade_v2` (OFF) controls only which grade dashboards treat as primary. Migration plan: additive columns now (done); after 30d of shadow data, compare monotonicity (empirical grades must order WR/exp strictly) before flipping the flag; legacy grade remains for rollback forever.

## 5. Edge Matrix Design (Phase D)

`GET /api/analytics/edge-matrix?min_n=20&limit=50` — latest snapshot generation across 12 pair/triple dimensions (incl. the new TrendScore×Breakout, Sector×Funding, OI×Positioning), ranked by expectancy, Wilson CI per cell, plus the bottom-10 "avoid" list. Rendered in Analytics → Probability.

## 6. Delivery Filters (Phase E)

Flag **`probability_gate_v1`** (OFF): AND-combines cohort expectancy ≥ `scanner.min_empirical_exp` (default 0.0) with the existing WR gate. Requires `probability_gate_enabled` ON to act. Unknown probability/expectancy never gates. The live WR gate's behavior is byte-identical when v1 is OFF.

## 7. Analytics Changes (Phase F)

New **Analytics → Probability** tab: track-record cards (7/30/90d WR·Exp·PF·n), probability-accuracy card (stamped prediction vs realized, mean abs error), Edge Matrix top-25 + worst-10 tables, empirical grade legend. Confidence-vs-probability and drift remain in the Calibration tab (CONFIDENCE.CALIBRATION.2).

## 8. Monetization Foundation (Phase G)

`GET /api/analytics/track-record` — windows (7/30/90d): WR/PF/expectancy/n; per-mode 30d; **probability accuracy** (avg predicted WR vs realized WR vs mean-abs-error on resolved stamped signals). Derived entirely from `signal_outcomes`; admin-proxied only — no public UI yet, as specified.

## 9. Backend / Frontend / Database / Flags

- **Backend:** `probability.py` (engine, Wilson, grades, gate v2), `outcome_learning.py` (+4 dims), `orchestrator.py` (evaluate-based stamping + extended gate), `api/analytics.py` (+2 endpoints), `groups.py` (+2 flags, +1 setting).
- **Frontend:** `types/index.ts` (+3 TradingSignal fields), `lib/supabase.ts` (mapping), `lib/admin-api.ts` (+2 methods/types), trading page (P-chips), analytics page (Probability tab).
- **DB migration (run in Supabase):** `database/probability-engine-migration.sql` — `empirical_grade` on signals + signal_outcomes (additive; code tolerates absence).
- **Flags:** `probability_gate_v1` OFF · `riskgrade_v2` OFF · (`probability_gate_enabled` remains as deployed — ON in production by founder choice) · `scanner.min_empirical_exp` = 0.0.

## 10. Validation Plan (Phase H executed + forward plan)

**30d simulation (in-sample upper bound, n=1,822):**

| Config | n | Volume | WR | Exp | PF |
|---|---|---|---|---|---|
| Baseline (current) | 1,822 | 100% | 36.1% | +0.128R | 1.20 |
| Gate WR≥45 | 792 | 43.5% | **59.6%** | **+0.877R** | **3.17** |
| Gate WR≥45 AND exp≥0 | 792 | 43.5% | 59.6% | +0.877R | 3.17 |

The expectancy filter adds nothing *in this window* (all ≥45%-WR bear cohorts already have positive expectancy) — it is the safety net for future regimes where WR and expectancy diverge. **Forward (out-of-sample) validation:** stamped `empirical_wr` vs realized outcomes accumulates daily; the probability-accuracy card is the live reliability readout. Re-check after ≥200 resolved stamped signals.

## 11. Expected ROI

Delivered-feed quality moves to the gated cohort line above. Volume cost: ~56% fewer alerts — the removed half had 17.9% WR / −0.43R (audited NULL/SIDEWAYS cohorts). RiskGrade 2.0 + Edge Matrix are decision-support: they direct the founder to the PF>3 cohorts and away from the PF<0.5 ones with sample-size honesty (CI).

## 12–13. Rollback / Deployment

Deploy Railway + Vercel; run `probability-engine-migration.sql` (before or after — tolerant). Flags to consider after observation: `probability_gate_v1` (once a regime with positive-WR/negative-exp cohorts appears), `riskgrade_v2` (after 30d shadow monotonicity check). Rollback = flags OFF (instant); columns are inert; `git revert` safe — `lookup_empirical` wrapper keeps old callers working.

## 14. GO / NO-GO

**GO.** Foundation reused, no new infra, every behavioral surface flagged OFF, 648 tests green (21 new engine tests), simulation shows the largest profitability delta measured on this platform. NO-GO only on: making probability REPLACE confidence in scoring (display-primary only, per spec) and any public exposure of the track record before 30 clean post-fix days.
