# SIGNAL PERFORMANCE MASTER
<!-- Consolidated from: POST_DEPLOY_RECOVERY_MEASUREMENT_1, RECOVERY_VALIDATION_DAY7_1, RECOVERY_READINESS_CHECK_1, LIVE_RECOVERY_MONITOR_1, PROFIT_PRESERVATION_1, ALPHA_MONITORING_1 -->
<!-- Last updated: 2026-06-23 · Authoritative source for all performance metrics, recovery protocol, and risk items -->

---

## SECTION 1 — Performance Baselines

### Pre-P0 Crisis Baseline (locked June 16)
| Metric | Value | Source |
|--------|-------|--------|
| Win Rate (7D) | **20.0%** | SIGNAL_ENGINE_TRUTH_1 |
| Profit Factor | **0.52** | SIGNAL_ENGINE_TRUTH_1 |
| Expectancy | **−0.39R** | SIGNAL_ENGINE_TRUTH_1 |

**Root causes (SIGNAL_QUALITY_AUDIT_3 — 5 root causes):**
1. `high_confidence_mode_enabled=ON` — 0/9 wins last 7D, 26.8% WR 30D, 26% of signal slots consumed
2. Contra-regime BUY in BEAR_TREND — WR=19%, no hard gate
3. NULL regime signals — WR=14.9%, N=677, contaminating grade pools
4. BUY+EARLY_BREAKOUT unpenalized — negative-expectancy cohort passing unblocked
5. Heuristic grade inversions — A(33.9%) < B(36.1%) < C(56.4%)

### Day 7 Measurement (June 23)
| Metric | D7 Value | vs Baseline | Target Range | Status |
|--------|----------|-------------|--------------|--------|
| Win Rate (7D) | **33.52%** | +13.52pp | 33–38% | ✅ IN RANGE |
| Profit Factor | **1.2266** | +0.707 | 0.95–1.35 | ✅ IN RANGE |
| Expectancy | **+0.137R** | +0.527R | −0.05 to +0.15R | ✅ IN RANGE |
| Resolved (7D) | **178** | — | ≥50 | ✅ |

**Recovery Score: 7.85/10. Decision: CONTINUE.**

Recovery Score formula: `0.30×WR_Score + 0.30×Exp_Score + 0.20×PF_Score + 0.10×Gate_Score + 0.10×VQ_Score`

### 30D Reference Baseline (as of June 23)
| Metric | Value |
|--------|-------|
| Win Rate | 34.84% |
| Profit Factor | 1.151 |
| Expectancy | +0.098R |
| Resolved | 2,130 |

---

## SECTION 2 — Recovery Timeline

| Date | Event | Commit |
|------|-------|--------|
| 2026-06-15 | AI disabled by founder (ANTHROPIC_API_KEY issue) — 100% heuristic from this date | — |
| 2026-06-16 | Pre-P0 crisis baseline locked: WR=20%, PF=0.52, Exp=−0.39R | — |
| 2026-06-16 | **P0 package applied** — 5 feature flag changes (see SIGNAL_ENGINE_MASTER §3) | — |
| 2026-06-19 | Grade D backstop bug fixed (was blocking ALL alerts June 15–19) | `9457738` |
| 2026-06-19 | FG-01/FG-02/H-02/PC-03/PC-04/H-11 fixed | `57e9cea` |
| 2026-06-19 | P1: FUTURES/TRENDING confidence floors raised to 85 | — |
| 2026-06-22 | STABILIZATION_CLOSEOUT — all P0/P1/P2 platform issues resolved | `75d0014` |
| 2026-06-22 | FRONTEND_SYSTEM_TRUTH 38-finding audit completed | — |
| 2026-06-22 | PRODUCTION_TRUTH_FIXES all 4 new P0s fixed | `e21b545`, `c85c14b` |
| 2026-06-23 | Day 7 measurement: WR=33.52% — Decision: CONTINUE | — |
| 2026-06-23 | **SIDEWAYS hard gate deployed** | `38b52fb` |
| 2026-06-23 | CONFIRMED_BREAKOUT exemption added | `d0f949a` |
| 2026-06-23 | **Monitoring freeze begins** (June 23–30, observe only) | — |

---

## SECTION 3 — WhatsApp Delivery Funnel

### Delivery by period
| Period | Generated/day | Eligible/day | Delivered/day | Delivery % | Notes |
|--------|--------------|--------------|---------------|------------|-------|
| Pre-P0 | ~57 | ~57 | ~15–20 | ~28% | No suppression; WR=20% — delivering bad signals |
| Post-P0, June 16–22 | ~48 | ~36 | ~0.17 | 0.5% | BTC SIDEWAYS → 99.5% probability gate suppression |
| Post-SIDEWAYS, June 23 | 64 | 45 | 27 | 60% | BTC BEAR_TREND; SIDEWAYS gate deployed |

**Key insight:** The near-zero delivery rate June 16–22 was caused by BTC regime SIDEWAYS (all SIDEWAYS attribution cohorts WR<40% → probability gate blocks 99%). This is CORRECT behavior. The platform has no edge in SIDEWAYS and should not send alerts.

**D7 (June 16–23) delivery funnel:**
generated=351 · eligible=260 · queued=28 · delivered=27 · shadowed=13 (dedup) · suppressed_other=219 (probability gate)

**H24 (June 23) delivery funnel:**
generated=64 · eligible=45 · queued=27 · delivered=27 · shadowed=13 · suppressed_other=5

**Steady-state probability gate suppression:**
- BEAR_TREND periods: ~11% (5/45 on June 23)
- SIDEWAYS periods: ~100% (all cohorts WR<40%)

### Volume by regime (steady-state)
- BEAR_TREND: ~20–27 deliveries/day
- SIDEWAYS: 0–3/day (HIGH_MOMENTUM + CONFIRMED_BREAKOUT exempt)
- BULL_TREND: 0/day (all cohorts probability-gated)

---

## SECTION 4 — Monitoring Protocol

### Freeze Period
**All gates frozen June 23–30. No strategy changes permitted.**

Frozen components:
- NULL regime hard gate, SIDEWAYS gate + CONFIRMED_BREAKOUT exemption
- Contra-regime gate v2, probability gate, early breakout penalty, riskgrade_v2
- TRENDING/FUTURES confidence floors (85)
- All probability thresholds, all confidence scoring

Permitted changes: Infrastructure, logging, dashboarding, documentation.

### Alert Thresholds
| Alert | Threshold | Baseline | Classification |
|-------|-----------|----------|---------------|
| WR CRITICAL | < 30% | 33.15% | Hard alert — act immediately |
| PF CRITICAL | < 1.0 | 1.204 | Hard alert |
| Expectancy CRITICAL | < 0 | +0.1245R | Hard alert |
| WR WARNING | < 32.3% (breakeven) | 33.15% | Monitor only |
| Volume WARNING | < 20 generated/day | 66/day | Check BTC regime first |
| SIDEWAYS exemption WR | < 40% on n≥10 | 45.9% | Revert exemption |

**Non-alert signals (expected behavior):**
- Low delivery count (0–3/day) — SIDEWAYS BTC regime, intended
- 80–90% probability gate suppression — SIDEWAYS regime, not malfunction
- claude_fallback_pct = 100% — AI toggle off, WR achieved heuristic, not degradation

### Checkpoint Schedule
| Date | Check |
|------|-------|
| **D3 (2026-06-26)** | Core metrics + gate rejections stability |
| **D7 (2026-06-30)** | Full measurement + SIDEWAYS.EXEMPTION.1 POSTFIX.1 + BULL_TREND gate decision |

### Measurement Endpoints
```
GET /api/analytics/track-record        → WR, PF, Exp by 7d/30d/90d
GET /api/analytics/performance-verification → cohort stability, grade validation
GET /api/analytics/telegram-delivery   → generated/eligible/suppressed/delivered
GET /api/analytics/monitor             → operational health, signals/day
GET /api/analytics/edge/regime         → WR by regime (30D)
GET /api/analytics/scans?window_hours=168 → gate rejection counts (7D)
```

### D7 Decision Framework
```
IF WR ≥ 33% AND PF ≥ 1.0 AND Exp > 0:
    → CONTINUE. Consider BULL_TREND gate assessment.

IF WR 30–33% AND PF ≥ 1.0 AND Exp > 0:
    → WATCH. Schedule D14 check.

IF WR < 30% OR PF < 1.0 OR Exp < 0:
    → ALERT. Diagnose by regime first.
      If SIDEWAYS exemption signals WR < 40%: revert SIDEWAYS.EXEMPTION.1

IF SIDEWAYS|SELL|CONFIRMED WR < 40% (n≥10):
    → REVERT: change `not in (HIGH_MOMENTUM, CONFIRMED)` back to `!= HIGH_MOMENTUM`
```

---

## SECTION 5 — Profitability Risk Register

### P0 — Act within 24h
| ID | Risk | Impact | Mitigation |
|----|------|--------|-----------|
| PR-P0-2 | **ANTHROPIC_API_KEY not set** | 100% heuristic (current state) | WR=33.52% achieved without AI — not urgent but limits future improvement |

### P1 — Act post June 30
| ID | Risk | Impact | Mitigation |
|----|------|--------|-----------|
| PR-P1-1 | **BULL_TREND ungated** — WR=21.65%, Exp=−0.330R, n=97 | Probability gate suppresses but pipeline still generates/logs them | Implement after D7 measurement |
| PR-P1-2 | **Probability MAE=40.9pp** — predicted 95-100 confidence → actual 35.5% WR | Probability accuracy unmeasured during recovery | Monitor via performance-verification endpoint |
| PR-P1-3 | **Heuristic grade inversions** in stamped data (A<B<C) | riskgrade_v2=ON shows empirical grades — correct; heuristic grades still internally inconsistent | Accumulate n≥30 stamped per grade for full promotion |
| PR-P1-4 | **CMC credits=0** — cache cold → fallback cascade | Python direct fallback added but relies on CMC_KEY | Monitor intel:fallback:status Redis key |

### P2 — Monitor
| ID | Risk | Notes |
|----|------|-------|
| PR-P2-1 | WR near warning threshold (33.15% vs 32.3% breakeven) | Only 0.85pp above breakeven — single bad day pushes into warning |
| PR-P2-2 | Regime dependency — edge concentrated in BEAR_TREND (68.4%) | If BTC shifts regime, platform goes silent |
| PR-P2-3 | KLINE_EMPTY elevated | 10.1% of coin-scans — API outage signature |
| PR-P2-4 | TRENDING mode negative 30D | WR=28.2%, Exp=−0.151R — probability gate blocks delivery correctly |

---

## SECTION 6 — Mode Performance (30D Reference)

| Mode | n | WR | Expectancy | Notes |
|------|---|----|-----------|-------|
| futures | 345 | 44.1% | +0.574R | Strongest mode; ALPHA.TRUTH.1 penalty removed |
| spot | 1,594 | 33.8% | +0.016R | Volume mode; breakeven range |
| trending | 117 | 28.2% | −0.151R | Probability gate blocks delivery; floor raised to 85 |
| high_confidence | 74 | 25.7% | +0.027R | PAUSED (flag OFF) |

---

## SECTION 7 — Gate Impact Reference

| Gate Applied | Date | Estimated Impact |
|--------------|------|-----------------|
| NULL regime hard gate (ALPHA.TRUTH.1) | Pre-June 16 | Removed N=677 WR=14.9% cohort (~39.6% of Grade A) |
| high_confidence_mode_enabled=OFF | June 16 | Removed 0/9 wins (7D) signal source |
| regime_hard_gate_v2=ON | June 16 | Contra-regime BUY rejected: WR=19%, Exp=−0.405R |
| probability_gate_v1=ON (40% WR) | June 16 | 2/3 live signal cohorts blocked from delivery |
| FUTURES/TRENDING conf floor 85 | June 19 | Raised from 82/78 → 85 |
| SIDEWAYS hard gate | June 23 | ~325 signals/month blocked (WR=30.47%) |
| CONFIRMED_BREAKOUT exemption | June 23 | ~61 signals/month unblocked (WR=45.9%) |

---

## SECTION 8 — Empirical Grade Validation (from PERFORMANCE_VERIFICATION_1)

Empirical grades (n=1,822 in-sample): **perfectly monotonic, zero inversions**

| Grade | WR | Expectancy | PF | n |
|-------|-----|-----------|-----|---|
| A+ | 73.5% | +1.286R | 5.85 | — |
| A | — | — | — | — |
| B+ | — | — | — | — |
| B | — | — | — | — |
| C | — | — | — | — |
| D | 13.6% | −0.581R | 0.33 | — |

Heuristic grades: INVERTED — A(33.9%) < B(36.1%) < C(56.4%).

**Promotion criteria (neither met yet):**
- `probability_gate_v1` full: ≥200 resolved stamped + MAE ≤0.25 + drift ±10pp + all n≥30 cells
- `riskgrade_v2` full: ≥30 stamped/grade in ≥3 buckets + zero stamped inversions + A+/A ≥ +0.3R vs baseline

Attribution snapshots: 1,243 rows in DB (nightly Celery 00:15 UTC). Cohort lookups work for common `regime|type|breakout` triples.
