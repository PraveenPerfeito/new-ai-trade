# CONFIDENCE.CALIBRATION.2

**Date:** 2026-06-11 · **Nature:** READ-ONLY analytics. Production confidence, scoring, grades, regime logic, AI validation, risk engine, and signal selection are untouched.

## 1. Architecture Overview

```
signal_outcomes ──┐
                  ├─→ confidence_calibration.py ──→ GET /api/analytics/confidence-calibration
attribution_      │      (pure compute, no writes)        │  (flag-gated, enabled:false when OFF)
snapshots ────────┘                                       ▼
   ▲                                        Analytics → Calibration tab
   └── outcome_learning.py nightly              ConfidenceCalibrationSection
       (conf_band now spec-banded;              (renders nothing when flag OFF)
        +mode|conf_band +type|conf_band)
```

Empirical confidence = measured historical win probability for a signal's band/context, resolved hierarchically: `band|regime|type` → `band|regime` → `band` → global, each level requiring n ≥ 30.

## 2. Files Modified

- `backend/analytics/confidence_calibration.py` (new) — banding, band stats (n/WR/exp/PF/avg winner/avg loser/mean stated), drift, dimension drift, founder insights, hierarchical lookup, data quality, trend history
- `backend/api/analytics.py` — `GET /analytics/confidence-calibration` (flag-gated)
- `backend/analytics/outcome_learning.py` — conf bands unified to spec (`<80/80-84/85-89/90-94/95-100`); +`mode|conf_band`, +`type|conf_band` dimension sets (19 total)
- `backend/system_settings/groups.py` — `confidence_calibration_v2` flag
- `lib/admin-api.ts` — `ConfidenceCalibrationResponse` types + `adminApi.analytics.confidenceCalibration()`
- `app/admin/analytics/page.tsx` — `ConfidenceCalibrationSection` + `CalBandRow` + `DriftChip` in the Calibration tab
- `backend/analytics/tests/test_confidence_calibration.py` (new, 13 tests) + band test update in `test_p0_expectancy_recovery.py`
- `scripts/confidence_calibration_audit.py` (new) — reusable Phase A audit query

## 3. Database Changes — **None.**

Reads `signal_outcomes` + `attribution_snapshots` (P0 migration). Band unification happened before the first nightly snapshot generation, so trend-history keys are consistent from day one.

## 4. APIs Added

`GET /api/analytics/confidence-calibration?window_hours=720` → bands, bands_regime_known, drift_by_regime/type/mode, insights, trend_history, empirical_lookup_levels, data_quality. Flag OFF → `{"enabled": false}`.

## 5. Dashboard Components Added (flag ON only)

Calibration tab gains: data-quality warning strip · 4 founder-insight cards (Most Overrated / Most Underrated / Best Actual / Worst Actual band) · stated-vs-actual dual-bar table for the regime-known cohort · same for all outcomes (NULL-era labeled) · drift-by-regime/type/mode panels · sample-size ⚠ markers on every n < 30 cell.

## 6. Analytics Queries

One outcomes SELECT per request (window-bounded, resolved-only), one snapshot trend SELECT (`dim_key='conf_band', window_days=7`), two COUNT sanity queries. All read-only.

## 7. Calibration Methodology

- Band = stated confidence bucket (spec bands). `empirical_confidence` = TP/(TP+SL) within the cell, rounded.
- **Drift = actual WR − mean stated confidence in the band** (e.g. stated 96.8, actual 44.2 → −52.6).
- Primary read = regime-known cohort (NULL-regime era contaminates global numbers; both shown, labeled).
- Hierarchical resolution prefers specificity but never returns a cell with n < 30.

## 8. Sample Size Requirements

n ≥ 30 per reliable cell (insights + lookup levels); 10 ≤ n < 30 shown with ⚠ low-sample marker; n < 10 suppressed in dimension drift.

## 9. Data Quality Checks

Total resolved · pending / stale-pending backlog · NULL-regime % (warn > 20%) · regimes observed (warn when single-regime window) · snapshot generations (warn < 7) · low-sample band list. All surfaced in API + UI.

## 10. Feature Flags

`confidence_calibration_v2` — default **OFF**. OFF: API returns `enabled:false`, UI renders nothing, zero behavior change. ON: analytics visible; production signals still identical.

## 11. Testing (executed)

13 new pure-function tests (banding boundaries, stats math incl. PF-undefined, drift sign, insight selection + low-sample suppression, lookup hierarchy L1→L4 fallbacks, spec example 95→47, flag default). Full backend suite **590 passed**; `tsc --noEmit` clean.

## 12. Deployment

Deploy Railway + Vercel. No migration. Enable `confidence_calibration_v2` from Founder settings to reveal the section. First trend points appear after tonight's 00:15 UTC snapshot run.

## 13. Rollback

Flag OFF (instant, UI + API hide). Code revert safe — nothing depends on the module.

## 14. Future Compatibility (Phase G)

`build_empirical_lookup()` / `empirical_confidence_for()` are the Probability Engine's resolution core; RiskGrade 2.0 bins on the same cells; Edge Matrix renders the same snapshot dimensions (`regime|type|breakout` already aggregated nightly); Outcome Learning trend history accumulates automatically.

## 15. Expected Business Impact

Measurement only — no WR/expectancy change this phase. Value: the confidence inversion becomes visible and quantified per band/regime/type/mode with honest sample sizes, giving the founder the evidence base to approve (or reject) probability-gated delivery in Phase 9.1. Audit numbers it will display on day one (30d): stated 95-100 → actual 35.5% global / 44.2% clean (drift ≈ −53); stated 85-89 → 42.1% / 57.6% (best band); 90-94 worst globally at 31.4%.

## 16. GO / NO-GO

**GO.** Zero production-path changes, zero migrations, flag-gated OFF, fully reversible, 590 tests green.
