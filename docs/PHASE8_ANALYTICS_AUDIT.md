# Phase 8.0 — Outcome Analytics Readiness Audit

**Date:** 2026-05-31  
**Type:** Audit + Implementation  
**Status:** Analytics infrastructure wired (Phase 8.0.1 complete). Regime gate pending (Phase 8.1B).

---

## Phase 8.0 — Readiness Audit

### Verdict: ❌ NOT READY (before 8.0.1) → ✅ INFRASTRUCTURE READY (after 8.0.1)

---

## Persistence Check

All 7 intelligence fields confirmed persisted to both tables:

| Field | signals table | signal_outcomes table | Scope |
|-------|-------------|----------------------|-------|
| `trend_score` | ✅ | ✅ | TRENDING mode (NULL for others) |
| `sector_status` | ✅ | ✅ | TRENDING mode |
| `breakout_type` | ✅ | ✅ | All modes |
| `breakout_strength` | ✅ | ✅ | All modes |
| `oi_interpretation` | ✅ | ✅ | Futures/HC only |
| `funding_trend` | ✅ | ✅ | Futures/HC only |
| `positioning_context` | ✅ | ✅ | Futures/HC only |
| `confidence` | ✅ | ✅ | All modes |
| `scanner_mode` | ✅ | ✅ | All modes |

**Data collection: COMPLETE. No missing persistence.**

---

## Analytics Query Gaps (before Phase 8.0.1)

| Gap | File | Problem |
|-----|------|---------|
| GAP-1 | `signal_metrics.py:get_outcomes()` | SQL SELECT missing all 7 intelligence fields |
| GAP-2 | `signal_metrics.py:get_analytics()` | No intelligence field breakdowns |
| GAP-3 | `edge_validation.py:_fetch_outcomes()` | Same SELECT gap |
| GAP-4 | `signal_metrics.py` | No TrendScore tier bucketing |
| GAP-5 | `analytics.py` | No intelligence calibration endpoint |
| GAP-6 | `analytics/page.tsx` | No Intelligence Performance section |

---

## Phase 8.0.1 — Analytics Intelligence Wiring (commit `270368e`)

### Files changed

| File | Change |
|------|--------|
| `backend/analytics/signal_metrics.py` | GAP-1,2,4,5 |
| `backend/analytics/edge_validation.py` | GAP-3 |
| `backend/api/analytics.py` | GAP-5: new `GET /analytics/intelligence` endpoint |
| `lib/admin-api.ts` | `IntelligencePerfRow` + `IntelligenceSummary` types + `intelligence()` |
| `app/admin/analytics/page.tsx` | GAP-6: `IntelligenceSection` component |

### What was added

**GAP-1 fix** — `get_outcomes()` SQL now returns all 7 intelligence fields.

**GAP-2 fix** — `get_analytics()` now returns 7 new breakdowns:
- `by_trend_score_tier` (ELITE/STRONG/GOOD/WEAK/N/A)
- `by_sector_status`
- `by_breakout_type`
- `by_breakout_strength`
- `by_oi_interpretation`
- `by_funding_trend`
- `by_positioning_context`

**GAP-3 fix** — `_fetch_outcomes()` in `edge_validation.py` now includes all 7 fields.

**GAP-4 fix** — `trend_score_tier()` helper: ELITE ≥85 / STRONG 70–84 / GOOD 50–69 / WEAK <50

**GAP-5 fix** — `get_intelligence_summary()` returns best-performing tier per dimension (min 5 samples). Exposed at `GET /api/analytics/intelligence`.

**GAP-6 fix** — Analytics page "Edge Validation" tab now shows **Intelligence Performance** section with best tier, win rate, avg RR, and sample count per dimension.

### Win rate calculability (after fix)

| Calculation | Status |
|-------------|--------|
| Confidence band win rate | ✅ Already worked |
| Mode win rate | ✅ Already worked |
| TrendScore tier win rate | ✅ Now works |
| Sector status win rate | ✅ Now works |
| Breakout type win rate | ✅ Now works |
| OI interpretation win rate | ✅ Now works (futures/HC only) |
| Funding trend win rate | ✅ Now works (futures/HC only) |
| Positioning win rate | ✅ Now works (futures/HC only) |

---

## Outcome Analytics Findings (4-day sample, May 27–30)

### Overall performance

| Metric | Value |
|--------|-------|
| Total resolved | 324 |
| Win rate | 9.0% |
| Avg R:R | −0.725 |
| SELL signals | 272 (84%) |
| BUY signals | 52 (16%) |

### Root cause of 9% win rate

**May 29 smoking gun:** BTC reversed bullish. The Python scanner fired 99 SELL signals (per-coin 4h indicators still bearish) at 0% win rate. Simultaneously, 35 BUY signals achieved 40% win rate. The scanner had no macro BTC regime gate — it treated each coin's lagging 4h trend as valid direction regardless of BTC's macro movement.

| Date | Direction | Total | Win Rate | Market |
|------|-----------|-------|---------|--------|
| May 28 | SELL | 170 | 8.8% | Falling |
| May 28 | BUY | 14 | 0.0% | BUY into falling market |
| **May 29** | **BUY** | **35** | **40.0%** | **BTC reversed UP** |
| **May 29** | **SELL** | **99** | **0.0%** | **Scanner still in SELL mode** |

**The signal detection works. The regime gate is missing.**

### Confidence calibration (all bands broken)

| Band | Win Rate | Expected |
|------|---------|---------|
| 90–100% | 10.5% | ~60% |
| 85–89% | 3.1% | ~50% |
| 80–84% | 8.3% | ~45% |

AI confidence scores have no predictive value because they're computed per-signal without macro regime context.

### Additional finding: `market_regime = NULL`

All 272 SELL signals have `market_regime = NULL` — the Python scanner never computes or stores BTC regime. The TypeScript `getMarketRegime()` only runs in the legacy TypeScript scanner path.

---

## Phase 8.1A — BTC Regime Architecture Audit

See [PHASE8_REGIME_AUDIT.md](PHASE8_REGIME_AUDIT.md) for full recommendation.

**Decision: Option B (port to Python). GO.**

---

## Phase 8 Readiness Summary

| Item | Status |
|------|--------|
| Data persistence — all 7 fields | ✅ Complete |
| Outcome resolution (TP/SL/TIMEOUT) | ✅ Working |
| Analytics query layer (GAP-1,2,3) | ✅ Fixed in 8.0.1 |
| TrendScore tier bucketing (GAP-4) | ✅ Fixed in 8.0.1 |
| Calibration intelligence API (GAP-5) | ✅ Fixed in 8.0.1 |
| Dashboard Intelligence section (GAP-6) | ✅ Fixed in 8.0.1 |
| BTC macro regime gate | ❌ Phase 8.1B |
| `market_regime` stored on signals | ❌ Phase 8.1B |
| 30-day clean outcome dataset | ❌ 4 days so far |

*Last updated: 2026-05-31*
