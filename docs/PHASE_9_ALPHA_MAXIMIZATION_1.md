# PHASE.9.ALPHA.MAXIMIZATION.1

**Date:** 2026-06-11 · **Data basis:** 1,809 resolved outcomes (30d) + 992 clean-cohort (BEAR_TREND-only) + 14d scan-health telemetry, extracted live from `signal_outcomes` + `scan_metrics_log` via `scripts/phase9_alpha_audit.py` and `scripts/phase9_triples.py`.

**Data integrity caveats (applied throughout):**
- The NULL-regime era (n=677, WR 14.9%) contaminates all 30d global numbers. Every alpha claim below was re-validated inside the regime-known BEAR_TREND cohort (n=992) before being accepted.
- May 30 – June 9 had a degraded coin universe + silent kline failures (June 6–9: 1–7 signals/day). The 7d window is thin (n=159).
- The whole 30d window is one regime (BEAR_TREND). Every "alpha" here is, strictly, *bear-market alpha*. Items are bucketed **Immediate / 7-day / 30-day** accordingly.

---

## 1. Executive Summary

The platform has a real, monetizable edge hiding inside a blended mediocre number. Blended 30d: **WR 36.0%, Exp +0.128R, PF 1.20**. But the regime-aligned core (SELL × BEAR_TREND, n=792): **WR 59.6%, Exp +0.877R, PF 3.17**. The system's problem is not signal generation — it is that it still ships its own anti-edge alongside the edge:

1. **Contra-regime BUYs** (n=200, WR 19%, −0.405R) — the soft +10-confidence gate provably fails. Removing them alone would have added ~+81R over 30 days.
2. **Confidence is inverted** — 83–85 band beats 95–100 band by 23 WR points *in clean data*. Intelligence-stacked confidence boosts anti-select. Confidence must become empirical probability.
3. **Risk score is inverted** — risk 35–44 → 76.2% WR vs risk 0–24 → 45.1%. The risk engine penalizes exactly the attributes that win.
4. **Three intelligence pipes are dead**: `sector_status` 100% NULL, `trend_score` 98.7% NULL, `funding_trend` never emits RISING/FALLING (only STABLE). They cost compute and provide zero attribution.
5. **June 6–9 the system silently died** (1–7 signals/day vs ~180 normal) and no alert fired. Monitoring watches infrastructure, not output.

**GO** — with the P0 list below. The platform is one calibration phase away from a publishable track record.

---

## 2. Platform Scorecard

| Area | Score | Rationale |
|---|---|---|
| Scanner | **74** | 11-gate pipeline + SIGNAL.QUALITY.1–3 solid; contra-regime leak; EARLY_BREAKOUT BUY anti-selects |
| Intelligence | **56** | Breakout/OI/positioning = real alpha. But 86% of signals have NULL futures intel; sector/trend pipes dead; funding classifier degenerate |
| Analytics | **82** | Outcome tracking, attribution, edge validation all working; pending backlog = 5, stale = 0. Missing: empirical probability surface |
| Dashboard | **76** | 4-center consolidation good; post-fix funnel honest; missing scan-integrity + edge-matrix views |
| Operations | **80** | Ops gates, fail-open coordinator, broker migration all proven. Redis ops within budget |
| Reliability | **66** | June 6–9 silent output collapse with zero alerts; cache cold-start chain only fixed today |
| Alpha Generation | **64** | Blended PF 1.20 is breakeven-plus; aligned cohort PF 3.17 proves the edge exists; calibration not yet capturing it |
| Monetization Readiness | **42** | Verified outcome data exists (the hard part); no public surface, no billing, no tiered delivery, track record window too short |

---

## 3. Hidden Alpha Opportunities (data-verified)

All stats from the clean BEAR_TREND cohort unless noted. Ranked by exploitability (effect size × sample × actionability):

| # | Alpha source | Evidence | Action |
|---|---|---|---|
| 1 | **Regime alignment** | SELL×BEAR 59.6%/+0.877 vs BUY×BEAR 19%/−0.405 | Hard gate v2 (P0) |
| 2 | **Confidence inversion** | 83–85: 67.8% vs 95–100: 44.9% | Empirical probability (P1) |
| 3 | **HIGH_MOMENTUM_BREAKOUT** | 81.8%/+1.621/PF 9.92 (n=33) | Priority delivery + Pro tier flag |
| 4 | **OI context (futures intel)** | NEUTRAL 75%/+1.736; NEW_SHORTS 57.5%/+1.042; vs NULL 49.5% | Extend to spot mode (P1) |
| 5 | **EXTREME_LONG positioning on SELL** | 63.2%/+1.272 (n=125) — contrarian crowd fade | Score boost exists; add to probability table |
| 6 | **Risk-score inversion** | risk 35–44: 76.2%/PF 7.93 vs 0–24: 45.1% | RISKGRADE.2 (P1) |
| 7 | **Funding STABLE** | 58.6%/+1.093 vs NULL 49.5% | Keep; fix RISING/FALLING classifier |
| 8 | **Grade C cohort** | 75.4%/+1.639 (n=61) — futures+breakout proxy | RISKGRADE.2 re-binning |
| 9 | **EARLY_BREAKOUT is direction-asymmetric** | SELL: 68% (n=50) vs blended 38.8% (n=103) → BUY-side ~17% | BUY-side EARLY penalty (P1) |
| 10 | **bb_expansion alone is anti-alpha** | 20.6%/−0.372 (n=68, global) | Remove standalone bb_expansion classification (P1) |

**Dead pipes (zero alpha, nonzero cost):** `sector_status` (100% NULL in outcomes), `trend_score` (98.7% NULL), `funding_trend` RISING/FALLING (never observed). **Fix propagation or stop persisting.**

---

## 4. Top 20 Profitability Improvements

Ranked by expected expectancy impact. Window key: **[I]**=Immediate, **[7d]**, **[30d]**=needs validation.

| # | Improvement | Expected impact | Risk | Window |
|---|---|---|---|---|
| 1 | Contra-regime hard gate v2 (`REGIME.ALPHA.1`): BUY in BEAR/CAPITULATION (and SELL in BULL/EUPHORIA) rejected unless HIGH_MOMENTUM_BREAKOUT or aligned OI | Blended exp +0.10→+0.25R; removes −0.4R cohort (~20% of volume) | Low (flag) | [I] |
| 2 | Empirical probability replaces confidence for gating (`CONFIDENCE.CALIBRATION.2`) | Eliminates inverted selection; est. +5–8pp WR on delivered set | Med | [7d] |
| 3 | Output-collapse alert: signals_24h < 20% of 7d avg → Telegram | Prevents repeat of June 6–9 (4 dead days ≈ 700 missed signals) | None | [I] |
| 4 | BUY-side EARLY_BREAKOUT penalty −8 in `detect_setup()` | Removes ~17%-WR sub-cohort | Low | [I] |
| 5 | Remove standalone `bb_expansion` breakout classification | Removes 20.6%-WR cohort (n=68/30d) | Low | [I] |
| 6 | Spot-mode futures intelligence (`spot_futures_intel` flag): compute OI/positioning/funding for spot signals when futures market exists | Brings +0.5R-delta context to 78% of volume currently NULL | Med (API cost ~3 calls/candidate post-gate) | [7d] |
| 7 | RISKGRADE.2: empirical grade bins (A+/A/B+/B/C/D from projected expectancy) | Grades become monotonic; founder + subscriber trust | Low | [7d] |
| 8 | Quality-score top-band audit: 85–100 band WR 44.5% < 70–84 53.1% — find the anti-selecting component | +2–4pp WR after recalibration | Low | [7d] |
| 9 | high_confidence mode merge into futures mode (7d: 0/9; redundant stricter caps, worse selection) | Removes a −1.0R/trade mode; simplifies beat schedule | Low | [7d] |
| 10 | Probability-gated Telegram delivery: only send P(win) ≥ 55% empirical | Published feed WR ≈ 60%+ | Med | [7d] |
| 11 | Fix funding_trend classifier (RISING/FALLING never fires — thresholds too wide vs 8h Redis history) | Restores a designed alpha input | Low | [I] |
| 12 | Fix sector/trend propagation for ALL modes (currently TRENDING-only maps, and trending n=33) | Activates two dead columns for attribution | Low | [I] |
| 13 | Regime-conditional RR targets: BEAR SELL target_mult 2.0→2.5 (PF 3.17 supports wider targets); SIDEWAYS 2.0→1.6 | +0.05–0.15R blended | Med | [30d] |
| 14 | SIDEWAYS regime tightening: 29.3%/−0.107 (n=140) — raise min_confidence… actually raise min *probability*, +require CONFIRMED breakout | Removes negative cohort | Low | [7d] |
| 15 | OUTCOME.LEARNING.1 nightly attribution snapshots (enables 2, 7, 10) | Foundation for all probability features | Low | [I] |
| 16 | Volatility filter: NORMAL-vol exp +0.008 vs LOW-vol +0.213 — investigate ATR-relative stop width in NORMAL | +0.05R potential | — | [30d] |
| 17 | Trending mode decision: n=33, WR 33% — fix universe propagation or retire | Stops noise spend | — | [30d] |
| 18 | Structure-stop attribution: tag `stop_method` (STRUCTURE/ATR) on signals to measure SIGNAL.QUALITY.1 stop performance | Validates/improves stop logic | None | [I] |
| 19 | SIGNAL.QUALITY.3 divergence/counter-EMA200 attribution (deployed today — needs its own outcome data) | Measurement only | None | [7d] |
| 20 | Re-validate MARKET_STRUCTURE.FIX.1 POSTFIX (ms_* rejection counts + unblocked-signal WR ≥ 48%) | Confirms or reverts threshold change | None | [7d] |

---

## 5. Top 10 Dashboard Improvements (TRADING.UI.2 / SYSTEM.UI.2 / ANALYTICS.UI.2 / INTELLIGENCE.UI.2)

Founder health-check target: <10 seconds. Impact/Effort/ROI scored H/M/L.

| # | Center | Change | Impact | Effort | ROI |
|---|---|---|---|---|---|
| 1 | Trading·Overview | **Edge Strip** at top: 7d aligned-cohort WR/Exp/PF + signals_24h vs 7d-avg sparkline + scan-integrity dot | H | M | H |
| 2 | System | **Scan Integrity tile**: zero-coin scans 24h, kline-failure rate, cache_source of last scan (redis/cmc_direct/coingecko/empty), signals_24h vs baseline | H | M | H |
| 3 | Trading·Signals | Show **empirical WR chip** per signal (from its regime×breakout×OI bucket) next to confidence — "Conf 95 · Hist 45%" kills false trust instantly | H | M | H |
| 4 | Analytics·Edge | **Calibration curve**: confidence band vs empirical WR line chart (the inversion made visible) | H | L | H |
| 5 | Analytics·Attribution | **Edge Matrix** heat-grid: regime × breakout_strength cells colored by exp, n overlaid | H | M | H |
| 6 | Intelligence·Providers | **Coverage panel**: % of last-24h signals with non-NULL OI/funding/positioning/sector/trend — dead pipes visible in one glance | M | L | H |
| 7 | Trading·Scanner | Flag scans with `coins_scanned>0 && signals==0 && duration<10s` as **DEGRADED** in scan history (silent-death signature) | M | L | H |
| 8 | Trading·Tactical | Group rows by regime-alignment (Aligned/Contra) with cohort WR header — already have RegimeAlignDot, elevate it | M | L | M |
| 9 | Analytics·Calibration | AI-vs-heuristic outcome comparison (validation_source × outcome) — measures whether Claude validation pays for itself | M | L | M |
| 10 | System | Alert configuration card: output-collapse threshold, fallback-active, kline-failure — show armed/last-fired | M | M | M |

Rejected as cosmetic: re-theming, animation work, additional summary tiles duplicating existing counts.

---

## 6. Top 10 Intelligence Improvements (INTELLIGENCE.POSTFIX.1)

1. **Fix `funding_trend` classifier** (`futures_funding.py` / `futures_intelligence.py`): RISING/FALLING never emitted in 30d. Audit the 3-reading Redis history thresholds; likely the delta threshold exceeds real 8h funding drift. *Immediate.*
2. **Propagate `sector_status` + `trend_score` in ALL modes** (`orchestrator.py`: maps built only under `mode == TRENDING`): build maps for every mode from the intelligence cache; cost is one Redis read per scan. *Immediate.*
3. **Spot futures intel** (`signal_pipeline.py` Step 8.5, flag `spot_futures_intel`): if `coin.binance_symbol in futures_symbols`, run `analyze_futures_intelligence()` for spot candidates that already passed the setup gate. *7-day.*
4. **Retire standalone `bb_expansion`** as a breakout type (`breakout_intelligence.py`): keep only as a modifier on price-level breakouts (the 30d_low+bb_expansion combo is the best signal in the system; bb_expansion alone is the worst). *Immediate.*
5. **Direction-aware EARLY_BREAKOUT scoring**: +5 only when breakout direction matches a regime-aligned signal; BUY-side EARLY in bear → −8. *Immediate.*
6. **OI coverage instrumentation**: OI fields NULL on 86% of signals (spot). After improvement 3, alert if coverage < 50% of futures-listed candidates. *7-day.*
7. **Regime history table** (`market_regime_log`: regime, computed_at, rsi, atr_pct, every scan): enables regime-transition alpha (post-transition WR likely differs) and backtests. Currently regime is only stamped per signal. *Immediate, trivial.*
8. **Probability lookup as an intelligence output** (see §10): the learning loop becomes an intelligence field (`empirical_wr`, `empirical_n`) persisted per signal. *7-day.*
9. **Breakout-strength on Telegram + dashboard sort priority** — HIGH_MOMENTUM signals (PF 9.92) should never queue behind 78-confidence noise. Sort tactical default by probability not recency. *Immediate.*
10. **Funding/OI snapshot age guards**: persist `intel_age_seconds` per signal; reject futures intel older than 15 min instead of silently using it. *7-day.*

---

## 7. Confidence Calibration Plan (CONFIDENCE.CALIBRATION.2)

**Finding:** confidence is inverted, even in clean cohort, even SELL-only (83–85: 67.8% > 89–91: 58.8% > 95–100: 53.7%). Root cause: intelligence boosts stack additively onto confidence, so maximum-boost signals (everything aligned, including late-trend extension) hit 95+ exactly when the move is most extended. Confidence measures *agreement*, not *probability*.

**Phase 1 — Display truth (Immediate, zero risk):**
- Backend: `GET /api/analytics/calibration` already computes per-band stats; extend `get_analytics()` (`backend/analytics/signal_metrics.py`) with `confidence_calibration` map {band → wr, n, exp}.
- Frontend: calibration curve in Analytics·Edge; empirical-WR chip in SignalsTab.
- DB: none.

**Phase 2 — Empirical probability (7-day validation):**
- Backend: `backend/analytics/probability.py` — `lookup_probability(regime, breakout_strength, oi_interpretation, signal_type, conf_band) -> {wr, n}` reading `attribution_snapshots` (§10). Hierarchical fallback: full key → drop OI → drop breakout → regime×type → global. Require n ≥ 30 at each level.
- `signal_pipeline.py`: after Step 9, stamp `signal.empirical_wr` + `empirical_n`; **gate**: flag `probability_gate_enabled` + `min_empirical_wr` (default 0.45) in `ScannerSettings` (`backend/system_settings/groups.py`, safety caps in `safety.py`).
- DB migration: `signals` + `signal_outcomes` +`empirical_wr NUMERIC`, +`empirical_n INT` (yes — additive, nullable, backward compatible).
- Telegram: show "Hist: 62% (n=214)" instead of raw confidence on the Grade line.
- Rollback: flag off → behavior identical to today.

**Validation:** 7 days dual-stamped (gate off, fields populated) → compare empirical_wr deciles vs realized outcomes (reliability curve slope > 0 required) → enable gate.

---

## 8. Risk Grade Evolution Plan (RISKGRADE.2)

**Finding:** grades non-monotonic in clean cohort (C 75.4% > B 50.9% > A 48.9%); risk score positively correlates with profit (35–44 band: 76.2% WR, PF 7.93). The quality formula's top band anti-selects (85–100: 44.5% < 70–84: 53.1%).

**Design:** grade = projected-expectancy bin from the probability lookup (§7):
A+ ≥ +1.0R · A ≥ +0.6 · B+ ≥ +0.35 · B ≥ +0.15 · C ≥ 0 · D < 0 (projected exp = empirical_wr × target_mult − (1−empirical_wr)).

- Backend: `risk.py` — new `empirical_grade()` alongside existing `validate_risk()` (untouched); `RiskResult.grade_factors` gains `empirical_exp`, `empirical_n`. Flag `use_empirical_grades`.
- Heuristic grade retained as `legacy_grade` column for A/B comparison; dashboards show empirical grade when flag on.
- DB: `signals` +`legacy_grade TEXT` (migration, additive).
- Quality-score audit (parallel, 7-day): log per-component contributions for signals entering the 85–100 band; identify the anti-selecting term (suspect: volume-spike weighting at extended highs).
- Validation: 7 days dual-graded → require monotonic WR across empirical grades before flipping the flag.

---

## 9. Regime Specialization Plan (REGIME.ALPHA.1)

Current data only covers BEAR_TREND + SIDEWAYS + NULL. Specialize only where data exists; park the rest behind config.

| Regime | Data | Action |
|---|---|---|
| BEAR_TREND | n=992, aligned SELL +0.877R | **Hard gate v2**: BUY requires HIGH_MOMENTUM_BREAKOUT or OI=NEW_LONGS; else reject (gate key `CONTRA_REGIME_REJECTION`). target_mult SELL 2.0→2.5 [30d validation] |
| SIDEWAYS | n=140, −0.107R | Require CONFIRMED+ breakout AND empirical_wr ≥ 50%; effectively halves SIDEWAYS volume |
| BULL_TREND | no data | Mirror of bear gate (SELL restricted) — ship dormant, activates on regime flip |
| HIGH_VOLATILITY | no data | Wider stops already handled by ATR; cap leverage tier −1; observe |
| EUPHORIA / CAPITULATION | no data | Keep ALPHA.TRUTH.1 behavior; observe |

- Backend: `signal_pipeline.py` Step 8 regime gate block (extends existing soft gate); per-regime params dict in `ScannerSettings` (`regime_overrides: dict`), safety-capped.
- Flag: `regime_hard_gate_v2`. Rollback = flag off (soft gate remains).
- Frontend: Regime tab shows active per-regime rules; gate rejections visible in existing `GateRejectionGrid` (add key to `GATE_REJECTION_KEYS` in `scan_metrics.py` + `_PERSISTED_GATE_KEYS` in `orchestrator.py`).

---

## 10. Outcome Learning Plan (OUTCOME.LEARNING.1)

Rule-based → outcome-based without ML.

**Database** (migration: yes, one new table):
```sql
CREATE TABLE attribution_snapshots (
  id BIGSERIAL PRIMARY KEY,
  window_days INT NOT NULL,            -- 7 | 30
  dim_key TEXT NOT NULL,               -- e.g. 'regime|type|breakout'
  dim_value TEXT NOT NULL,             -- e.g. 'BEAR_TREND|SELL|CONFIRMED_BREAKOUT'
  n INT, tp INT, sl INT, wr NUMERIC, exp NUMERIC, pf NUMERIC,
  computed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ON attribution_snapshots (dim_key, dim_value, window_days, computed_at DESC);
```

**Backend:**
- `backend/analytics/outcome_learning.py` — `compute_snapshots()`: pure SQL GROUP BY over `signal_outcomes` for the dimension sets used by `lookup_probability()` (single, pair, triple combos; n≥10 retained).
- Celery beat task `outcome-learning-nightly` (`beat_schedule.py`, 1×/day — ~10 queries, negligible AMQP/Redis cost).
- `probability.py` reads latest snapshot generation (in-process cached 1h — same 3-layer pattern as settings).

**Analytics:** snapshots power §7 lookup, §8 grades, Edge Matrix (§5.5), and a "Top/Bottom combos" API (`GET /api/analytics/edge-matrix` via existing admin proxy).

**Dashboard:** Analytics·Attribution gains Edge Matrix grid + Winning/Losing combo tables (top 10 / bottom 10 by exp, n≥30).

**Expected impact (from current snapshot math):** gating delivery at empirical_wr ≥ 45% on the last 30d would have kept 1,021 of 1,809 signals at blended **WR ~52%, exp ~+0.6R, PF ~2.3** (vs 36%/+0.128/1.20 ungated). 7-day validation required before gating.

---

## 11. Stability Findings (STABILITY.POSTFIX.1)

1. **Silent output collapse (CRITICAL, proven June 6–9):** 1–7 signals/day for 4 days; no alert. Monitoring watches worker heartbeat/Redis/API health — all green while output was dead. **Fix:** `backend/analytics/monitoring.py` add `signals_24h_vs_baseline` check (DB-authoritative count ÷ trailing-7d avg < 0.2 for >6h → Telegram, 6h throttle). *No new infra.*
2. **Kline-failure invisibility:** scans "scanned" 44 coins in 6s — every coin aborted at the <60-candle check (Binance failures), counted as scanned, not errored. **Fix:** count empty-candle aborts as `KLINE_EMPTY` in `gate_rejections` (`signal_pipeline.py` Step 1) → visible in GateRejectionGrid + scan history DEGRADED badge.
3. **Cache cold-start chain** — fixed today (CMC-direct fallback). Residual risk: CMC quota exhaustion makes direct calls fail → ensure `_fallback_cmc_direct` failures still fall through to CoinGecko (they do) and that the fallback-status Redis key reflects `cmc_direct` source (extend `_record_fallback_event` provider field).
4. **scan_metrics_log day gaps** (June 5: 60 scans, June 6: 79 vs ~190 normal) — beat or worker outages partially invisible; the §11.1 alert covers the symptom; add `scans_24h` to the same check.
5. **Race:** `_btc_regime_cache` 5-min in-process cache per worker process — concurrent modes can compute regime twice; harmless (idempotent) — no action.
6. **Dead metrics:** `sector_status`/`trend_score` columns written as NULL on every non-trending signal (storage noise until §6.2 lands). `timeout` outcomes = 0 in 30d — auto-timeout works (pending_stale=0); no orphan risk.
7. **Polling:** post-OPS.CONSOLIDATION.1 budgets hold (dashboard 60–120s); no further reduction needed.

---

## 12. Monetization Plan

**Asset:** verified, DB-backed track record of the aligned cohort: **59.6% WR, +0.877R, PF 3.17, n=792 over 30d**. This is publishable *as the bear-regime SELL cohort* — honest framing matters and is itself a differentiator.

**Preconditions (P0):** probability gating live (§7) so the *delivered* feed matches the published stats; 30 contiguous days of post-fix data (start counting 2026-06-12); auto-generated performance page reading `signal_outcomes` (no manual claims).

| Tier | Price | Delivery | Gate |
|---|---|---|---|
| Free | $0 | 1–2 signals/day, 30-min delay, no TP/SL detail | empirical_wr ≥ 55%, teaser |
| Paid | $39/mo | Full real-time Telegram feed + TP/SL/leverage | empirical_wr ≥ 50% |
| Pro | $99/mo | Paid + dashboard access (read-only signals/tactical/analytics) + HIGH_MOMENTUM instant alerts + API | all delivered signals |

- Billing: Whop or LaunchPass on Telegram (zero code) first; Stripe + Supabase plan column second (plumbing exists in `access-control.ts` — `plan` already gates confidence floor/daily caps).
- Public page: `/performance` Next.js route reading a sanitized aggregate API (no admin auth) — outcomes only, no open signals.
- **30-day item.** Do not launch on the current window (single regime + distorted era).

---

## 13–15. Backend / Frontend / Database Changes (consolidated)

| Item | Backend (files/functions) | Frontend | DB migration |
|---|---|---|---|
| Regime hard gate v2 | `signal_pipeline.py` (Step 8 gate), `orchestrator.py` + `scan_metrics.py` (gate key), `groups.py`+`safety.py` (flag) | GateRejectionGrid auto-picks up key; Regime tab rules card | No |
| Output-collapse alert | `monitoring.py` (`check_output_baseline()`), `beat_schedule.py` (reuse anomaly 2h task), `telegram_notifier.py` (ops alert) | System alert-config card | No |
| EARLY_BREAKOUT BUY penalty + bb_expansion retire | `breakout_intelligence.py` (`detect_breakout_strength()`), `signal_pipeline.py` scoring | — | No |
| funding_trend fix | `futures_funding.py` thresholds; unit tests | — | No |
| Sector/trend all-mode propagation | `orchestrator.py` (build maps unconditionally from intel cache) | Intelligence coverage panel | No |
| Attribution snapshots | `outcome_learning.py` (new), `beat_schedule.py` (+1 task) | — | **Yes** (`attribution_snapshots`) |
| Probability lookup + gate | `probability.py` (new), `signal_pipeline.py` stamp+gate, `groups.py` flag | Empirical-WR chips, calibration curve, Edge Matrix (Analytics page) | **Yes** (+2 cols signals/outcomes) |
| RISKGRADE.2 | `risk.py` (`empirical_grade()`), flag | Grade badges unchanged (values shift); legend update | **Yes** (+legacy_grade) |
| Spot futures intel | `signal_pipeline.py` Step 8.5, flag | Coverage panel | No |
| KLINE_EMPTY gate key | `signal_pipeline.py`, `scan_metrics.py`, `orchestrator.py` | Scan history DEGRADED badge (`ScannerTab`) | No |
| stop_method attribution | `trade_levels()` returns method; `db.py` save; `signal_metrics.py` register | — | **Yes** (+stop_method TEXT, both tables) |
| Performance page | sanitized aggregate route `app/api/performance/route.ts` | `app/performance/page.tsx` (public) | No |

All flags live in existing `ScannerSettings`/`FeatureFlags` groups → 3-layer cache + pub/sub propagation + safety caps already apply. Every change is flag-off-by-default except display-only items.

## 16. Testing Plan

- Unit: gate v2 paths (aligned/contra/override-by-momentum ×6 regimes); probability fallback hierarchy (5 levels, n-threshold boundaries); empirical grade bins; funding classifier with synthetic 3-reading histories; KLINE_EMPTY counting. Extend `test_signal_pipeline_quality_controls.py`, `test_breakout_intelligence.py`, new `test_probability.py`, `test_outcome_learning.py`.
- Integration: nightly snapshot task against seeded `signal_outcomes` fixture; tactical route returns new fields; `npx tsc --noEmit` zero errors.
- Validation queries: reliability curve (probability decile vs realized WR), gate-on/off shadow comparison (stamp but don't gate for 7 days).

## 17. Deployment Plan

1. **Wave 1 (Immediate):** alerts + telemetry + scoring tweaks (items 3,4,5,11,12,18 of §4) — no migrations, no flags needed except scoring (flag `signal_quality_4`). Deploy Railway+Vercel, observe 48h.
2. **Wave 2 (7-day):** migrations (snapshots table + columns) → nightly task → dual-stamp probability/grades (gates OFF) → 7 days shadow data → review reliability → enable `probability_gate_enabled`, `use_empirical_grades`, `regime_hard_gate_v2` one at a time, 48h apart.
3. **Wave 3 (30-day):** regime RR overrides, spot futures intel ramp, monetization launch after 30 clean days.
- **Rollback:** every wave = flag off (no schema rollback needed; columns nullable/additive). Wave 1 scoring revert = single flag.

## 18. Expected ROI

| Change | Expected (validated basis) |
|---|---|
| Regime hard gate v2 | Blended exp +0.13 → ~+0.30R (removes −0.405R × ~20% volume) |
| Probability gating @0.45 | Delivered-set WR 36→~52%, PF 1.2→~2.3 (backtest on 30d data) |
| EARLY-BUY + bb_expansion fixes | +0.02–0.04R blended |
| Output-collapse alert | Recovers ~120–180 signals/day on failure days (June 6–9 = ~700 missed) |
| Monetization (post-validation) | 100 paid × $39 + 20 pro × $99 ≈ $5.9k MRR at modest conversion on a 55%+ published WR |

## 19. P0 / P1 / P2 Roadmap

- **P0 (this week):** output-collapse alert · KLINE_EMPTY telemetry · regime hard gate v2 (flagged) · EARLY-BUY penalty · bb_expansion retire · funding classifier fix · sector/trend propagation · stop_method attribution · snapshots table + nightly task · calibration curve UI.
- **P1 (validate over 7 days, then enable):** probability stamp→gate · RISKGRADE.2 · quality top-band audit · high_confidence retirement · spot futures intel · probability-gated Telegram · Edge Matrix UI · empirical-WR chips.
- **P2 (30 days):** regime RR overrides · volatility stop study · trending mode verdict · performance page + tier launch · BULL-regime mirror gate validation (when regime flips).

## 20. GO / NO-GO

**GO.** The edge is real (PF 3.17 aligned cohort, n=792), the loss sources are identified and gateable, and every fix rides existing infrastructure (settings flags, gate-rejection telemetry, attribution analytics, Celery beat). NO-GO applies only to: immediate monetization launch (needs 30 clean days), regime RR retuning (single-regime data), and any ML/embedding infrastructure (explicitly unnecessary — SQL GROUP BY captures the entire learning loop at this scale).

---
*Safety check (§ Part 12): every recommendation is additive + flag-gated; no changes to ADMIN.CONSOLIDATION.1 routes, TRADING.UI components' contracts (only additions), ALPHA.TRUTH.1 gates (hard NULL-regime gate untouched; v2 extends it), SIGNAL.QUALITY.1–3 scoring (penalties added behind `signal_quality_4`), OPS.CONSOLIDATION.1 budgets (+1 beat task/day, ~10 queries), or INTELLIGENCE.CENTER.1 tabs (panels added, none removed).*
