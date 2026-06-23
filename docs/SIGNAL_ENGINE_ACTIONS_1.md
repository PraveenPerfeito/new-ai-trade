# SIGNAL_ENGINE_ACTIONS_1.md

**Date:** 2026-06-19  
**Status:** FINAL — No new audits. Execution and monitoring only until 2026-06-23.  
**Sources synthesized:**
- `SIGNAL_ENGINE_TRUTH_1.md` — 30D / 1,708 resolved signal audit
- `SIGNAL_QUALITY_END_TO_END_VALIDATION_1.md` — 9-phase production audit
- `SIGNAL_QUALITY_AUDIT_3.md` — Root cause analysis, priority matrix, GO/NO-GO
- `LIVE_RECOVERY_MONITOR_1.md` — Recovery monitoring protocol, Day 7 decision framework
- `MASTER_PLATFORM_STATUS.md` — Current system state, applied changes

**Constraints:** No new features. No new indicators. No AI changes. No UI redesign.  
**Scope:** Flag toggles, settings changes, code changes already in production, monitoring.

---

## PART A — Complete Recommendation Inventory

Every recommendation from all source documents, classified.

### DONE — Applied 2026-06-16 (P0 flag toggles, no code deployment)

| # | Action | Applied | Impact Basis |
|---|--------|---------|-------------|
| A1 | Disable `high_confidence` mode (`high_confidence_mode_enabled=False`) | ✅ 2026-06-16 | 0/9 wins last 7D, 26.8% WR 30D [P1.INTEL] |
| A2 | Enable probability gate at WR≥40 (`probability_gate_v1=True`, `min_empirical_wr=40.0`) | ✅ 2026-06-16 | 2/3 live signals WR<40%; would block Grade D (13.6% WR) [LIVE] |
| A3 | Enable `regime_hard_gate_v2` (hard reject contra-regime without HIGH_MOMENTUM override) | ✅ 2026-06-16 | Contra-regime BUY N=200, WR=19%, Exp=−0.405R [REGIME.V2] |
| A4 | Enable `early_breakout_penalty_v1` (−8 setup score for BUY+EARLY_BREAKOUT) | ✅ 2026-06-16 | BUY+EARLY asymmetrically poor; SELL+EARLY at 68% WR untouched [PHASE.9.P0] |
| A5 | Enable `riskgrade_v2` (empirical grades as primary display, corrects position sizing) | ✅ 2026-06-16 | Heuristic grades inverted: A=33.9% < C=56.4%; empirical: zero inversions A+ to D [PERF.VERIF.1] |

### DONE — Applied 2026-06-19 (P1 — code changes deployed)

| # | Action | Applied | Impact Basis |
|---|--------|---------|-------------|
| B1 | FUTURES `min_confidence` 82→85 | ✅ 2026-06-19 | 82–84 band is negative-expectancy zone (−0.09R); same logic as spot floor raise [ALPHA.TRUTH.1] |
| B2 | TRENDING `min_confidence` 78→85 | ✅ 2026-06-19 | 78–84 entirely in negative-expectancy zone; the most structurally unjustified floor in the system [SQA3] |
| B3 | Intelligence boost inflation cap: `base_conf < 87` → cap at 89 (HIGH_MOMENTUM_BREAKOUT exempt) | ✅ 2026-06-19 | 90–94 band is system's worst performer (31.4% WR) due to boosted borderline signals [CONF.CAL.2] |
| B4 | Grade D empirical backstop in `should_suppress_send()` — suppresses Grade D even without WR stamp | ✅ 2026-06-19 | Grade D WR=13.6%, Exp=−0.581R [PERF.VERIF.1]; backstop is insurance if prob gate misses |
| B5 | Scheduler `enabled` Redis key: 90-day TTL (prevents orphaned key accumulation) | ✅ 2026-06-19 | Operational hygiene; prevents silent failures on redeploy [PLATFORM.STABILIZATION.1] |

### PENDING — Waiting for Day 7 data (2026-06-23)

| # | Action | Waiting For | Decision Point |
|---|--------|------------|----------------|
| C1 | SIDEWAYS BTC regime gate: hard reject directional signals in SIDEWAYS without HIGH_MOMENTUM | 7D data post-P0 to confirm SIDEWAYS is the cause of 7D WR collapse | 2026-06-23 |
| C2 | False negative audit: verify OI_NEUTRAL, Grade A+, HIGH_MOMENTUM not blocked by probability gate | Gate effectiveness data from real scans post-2026-06-16 | 2026-06-23 |
| C3 | Recovery Score ≥ 7.0 + WR ≥ 33% validation | Resolved outcomes from P0-flagged signals | 2026-06-23 |

### PENDING — Waiting for Day 30 data (2026-07-16)

| # | Action | Waiting For | Decision Point |
|---|--------|------------|----------------|
| D1 | Formal `probability_gate_v1` promotion (requires ≥200 resolved stamped signals, MAE ≤0.25, drift ±10pp) | Stamped signals to reach n≥200 (was n=1 at audit date) [PERF.VERIF.1] | 2026-07-16 |
| D2 | Formal `riskgrade_v2` promotion (requires ≥30 stamped/grade in ≥3 buckets, zero stamped inversions, A+/A ≥+0.3R vs baseline) | More resolved stamped signals per grade | 2026-07-16 |
| D3 | ADX ≥30 scoring relax: +8 → +4 (possible over-reward of marginal trend strength) | 30D clean P0 signal outcomes to validate ADX cohort WR | 2026-07-16 |
| D4 | RSI pullback zone validation (BUY RSI 42–50 / SELL RSI 50–58 → +8) | 30D outcomes to confirm pullback entry timing is genuinely alpha | 2026-07-16 |
| D5 | 4h RSI zone check validation (BUY 45–68 → +8, >75 → −8) | 30D outcomes to confirm 4h context improves WR vs baseline | 2026-07-16 |
| D6 | Structure-aware stop vs flat ATR stop WR comparison | 30D outcomes of signals using structure stops vs ATR fallback | 2026-07-16 |
| D7 | P1.3: Intelligence boost inflation investigation of 90–94 band (needs `pre_boost_confidence` field in schema) | DB schema addition + 30D data collection | After schema deployed |

### REJECTED — No action, data basis shown

| # | Recommendation | Status | Data Basis |
|---|----------------|--------|-----------|
| E1 | Add more indicators to `detect_setup()` | ❌ REJECTED | Signal quality issues are structural (regime, confidence floor, gate configuration), not indicator coverage. No marginal WR gain from additional indicators has been demonstrated. Complexity cost without data basis. |
| E2 | Re-enable `high_confidence` mode | ❌ REJECTED | 0/9 wins last 7D. 26.8% WR 30D. −0.196R expectancy. The mode's min_mcap/min_vol filters do not predict WR. Re-enable only if WR ≥ 40% over ≥30 signals after full recovery. [P1.INTEL] |
| E3 | Add more Claude AI calls (lower AI_MIN_SETUP_SCORE below 78) | ❌ REJECTED | No WR gain demonstrated. Setup score gate is the correct filter. Credit cost without expectancy improvement. [SQA3 scope] |
| E4 | Loosen probability gate threshold below 35% | ❌ REJECTED | WR < 35% = negative expectancy at median 2.1:1 RR (breakeven = 32.3%). Any threshold below 35% permits negative-EV signal delivery by definition. Only lower under PARTIAL REVERT conditions (Section 10 of LIVE_RECOVERY_MONITOR_1.md). |
| E5 | Use stated confidence >89 as a quality filter | ❌ REJECTED | 90–94 band actual WR = 31.4% — WORSE than 85–89 (42.1%). Higher stated confidence does not predict higher actual WR. The inversion is caused by boosted borderline signals. [CONF.CAL.2] |
| E6 | Filter or block heuristic Grade C signals | ❌ REJECTED | Heuristic Grade C = 56.4% WR, Exp=+0.962R — the BEST heuristic grade. Grade C is 98.9% futures + 70.3% confirmed breakout. Blocking Grade C is directionally wrong. [RISKGRADE.1] |
| E7 | Trust heuristic Grade A for positive filtering | ❌ REJECTED | Heuristic Grade A = 33.9% WR, below system breakeven. Any system using heuristic A as a quality signal is selecting a losing cohort. Use empirical grade A+ (73.5% WR) instead. [PERF.VERIF.1] |
| E8 | Remove or soften NULL regime hard gate | ❌ REJECTED | NULL regime = WR 14.9%, Exp=−0.543R, N=677. Strongest gate in the system. No override case documented. [ALPHA.TRUTH.1] |
| E9 | Remove OI_NEUTRAL confidence boost or block OI_NEUTRAL signals | ❌ REJECTED | OI_NEUTRAL = WR 76.3%, Exp=+1.776R, N=38 — highest documented futures alpha. Blocking OI_NEUTRAL would be the single most destructive gate change possible. [ALPHA.TRUTH.1] |
| E10 | Re-enable BB expansion detection (BB.EXPANSION.RETIREMENT.1) | ❌ REJECTED | Retired and locked with behavioral regression tests. No new data supporting re-enable. |
| E11 | Apply `apply_founder_thresholds=True` without understanding mode-specific minimums | ❌ REJECTED | Founder floors can tighten but NEVER loosen below ALPHA.TRUTH.1 per-mode minimums. Aggressive preset's 72 cannot undo spot's 85. Flag is OFF by default for this reason. [SETTINGS.WIRE.1] |
| E12 | Redesign admin UI during recovery window | ❌ REJECTED | PLATFORM.SIMPLIFICATION.1 complete. No UI changes during active recovery monitoring period. |

---

## PART B — Final Action List Ranked by Expected Impact

Actions that are DONE or IN PROGRESS, ranked by documented or estimated WR/PF/Exp contribution. Cumulative impact assumes all prior rows are applied.

| Rank | Action | WR Impact | PF Impact | Exp Impact | Status |
|------|--------|-----------|-----------|-----------|--------|
| 1 | Probability gate WR≥40 (P0.2) | +4–6pp | +0.40–0.60 | +0.18–0.25R | ✅ DONE |
| 2 | Disable high_confidence mode (P0.1) | +3–5pp | +0.30–0.50 | +0.15–0.20R | ✅ DONE |
| 3 | REGIME_HARD_GATE_V2 (P0.3) | +2–3pp | +0.20–0.35 | +0.10–0.14R | ✅ DONE |
| 4 | TRENDING min_conf 78→85 (P1.1) | +2–3pp | +0.15–0.25 | +0.08–0.12R | ✅ DONE |
| 5 | FUTURES min_conf 82→85 (P1.2) | +1–2pp | +0.10–0.18 | +0.05–0.08R | ✅ DONE |
| 6 | EARLY_BREAKOUT_PENALTY_V1 (P0.4) | +1–2pp | +0.08–0.15 | +0.04–0.07R | ✅ DONE |
| 7 | Grade D backstop (P1.5) | Overlaps P0.2 | Redundant safety | Redundant safety | ✅ DONE |
| 8 | Boost inflation cap base<87→cap@89 (P1.3) | +1–2pp est. | +0.05–0.15 | +0.03–0.07R | ✅ DONE |
| 9 | riskgrade_v2 display (P0.5) | 0pp direct | 0 direct | 0 direct / corrects sizing | ✅ DONE |
| 10 | SIDEWAYS regime gate (pending Day 7) | +2–4pp est. | +0.20–0.40 | +0.08–0.16R | ⏳ PENDING |
| — | Additional indicators, AI additions | N/A | N/A | N/A | ❌ REJECTED |

**Combined P0+P1 projection (all 8 executed rows):**  
7D WR: 20% → 38–45% · Exp: −0.39R → +0.15–0.35R · PF: 0.52 → 1.35–1.85 · Volume: 100% → 35–50%

---

## PART C — Pending Action Details

### C1 — SIDEWAYS BTC Regime Gate

**Reason:**  
The regime audit (SQA3 §5) identified SIDEWAYS as the largest unaddressed structural gap. When BTC is in SIDEWAYS regime, directional signals (BUY/SELL) have no trend backing. The system currently has no hard gate for SIDEWAYS — only a +5 confidence adjustment for HIGH_VOLATILITY (a different regime). The 7D WR collapse from 35% to 20% is consistent with a BULL_TREND → SIDEWAYS transition ~7 days before 2026-06-16. The 15pp WR gap (7D vs 30D) exceeds the monitoring anomaly threshold (12pp).

**Expected benefit:**  
Estimated +2–4pp WR in SIDEWAYS-dominant weeks. No impact in BULL_TREND (where the gate would not fire). In a SIDEWAYS regime, blocking directional signals without HIGH_MOMENTUM breakout removes the highest false-breakout cohort (SIDEWAYS + directional, no momentum = suspected ~30–35% WR).

**Risk:**  
If incorrectly calibrated, could block SIDEWAYS + HIGH_MOMENTUM breakouts that have legitimate WR. Mitigation: apply the same HIGH_MOMENTUM override logic used in `contra_regime_gate()`. No data yet exists for SIDEWAYS WR by breakout type — this is why Day 7 data is required before implementation.

**Files affected:**  
- `backend/core/scanner/signal_pipeline.py` — add SIDEWAYS branch to `contra_regime_gate()` or a new `sideways_gate()` function in Step 10.5
- `backend/analytics/scan_metrics.py` — add `SIDEWAYS_REJECTION` to `GATE_REJECTION_KEYS`
- `app/admin/system/page.tsx` — GateRejectionGrid already handles dynamic keys

**Decision gate:** Day 7 (2026-06-23). Requires: WR ≥ 33% (P0 working) AND SIDEWAYS_REJECTION signals resolving as losses > 55% rate from pre-P0 data. If 7D data is insufficient (too few SIDEWAYS signals), defer to Day 30.

---

### C2 — False Negative Audit at Day 7

**Reason:**  
The probability gate blocks signals with `empirical_wr < 40`. If attribution_snapshots are stale or insufficient at n≥30 for key cohorts (OI_NEUTRAL, HIGH_MOMENTUM, Grade A+), these should-pass signals will be incorrectly blocked. This is the most consequential false negative risk.

**Expected benefit:**  
Zero direct WR change. But confirming no false negatives prevents the gate from destroying its own best signals. OI_NEUTRAL at 76.3% WR blocked = wasted +1.776R expectancy per signal.

**Risk:**  
If OI_NEUTRAL empirical_wr stamp is < 40 due to sparse attribution_snapshots data (n < 30 for OI_NEUTRAL), the gate will silently block the system's best cohort. This is an attribution data coverage problem, not a gate problem.

**Files affected:**  
None — this is a monitoring query, not a code change. Run Appendix B queries from LIVE_RECOVERY_MONITOR_1.md.

**Decision gate:** Day 7 (2026-06-23). Run the OI_NEUTRAL false negative SQL query. Expected result: 0 rows. Any rows = critical — lower `min_empirical_wr` to 35 temporarily and investigate attribution_snapshots coverage for OI_NEUTRAL row n.

---

### C3 — Recovery Score Checkpoint

**Reason:**  
The Recovery Score is a composite 0–10 metric (LIVE_RECOVERY_MONITOR_1.md §9) measuring actual recovery across WR (30%), Exp (30%), PF (20%), Gate quality (10%), and Volume quality (10%). It provides an objective Continue/Hold/Revert signal independent of any single metric.

**Expected benefit:**  
Provides the decision input for P1. If Recovery Score ≥ 7.0 AND WR ≥ 33%, P1 code changes are validated. Note: P1 code changes (TRENDING/FUTURES floor raises) were already deployed on 2026-06-19. The Day 7 checkpoint validates whether those changes are producing the expected effect.

**Risk:**  
The score may be depressed Day 3–5 due to pre-P0 signals still resolving in the 7D window. Do not revert based on Day 3–5 data alone.

**Files affected:**  
None — monitoring only. Data comes from `signal_outcomes` + `gate_rejections` per scan.

**Decision gate:** 2026-06-23. See Section D below for the decision tree.

---

### D1–D7 — Day 30 Data Items

Each of these requires 30D of clean P0 signal outcomes. These are data collection checkpoints, not pending code changes.

| Item | What to measure | Decision criteria |
|------|-----------------|------------------|
| D1: Formal prob gate promotion | ≥200 resolved stamped signals; MAE ≤0.25; drift ±10pp; all n≥30 cells calibrated | Turn from empirical approval → formal promotion |
| D2: riskgrade_v2 promotion | ≥30 stamped/grade in ≥3 buckets; zero stamped inversions; A+/A ≥+0.3R vs baseline | Toggle flag from temporary → permanent |
| D3: ADX ≥30 relax (+8→+4) | WR comparison for signals with ADX 30–39 vs ADX ≥40 in 30D P0 window | Only relax if ADX 30–39 cohort WR ≥ 45% (otherwise current +8 is justified) |
| D4: RSI pullback zone validation | WR for BUY RSI 42–50 vs other RSI bands in 30D P0 window | Only validate if this cohort WR ≥ 45% |
| D5: 4h RSI zone validation | WR for BUY conf=45–68 vs >75 comparison | Current −8 for >75 is justified if overbought 4h WR < 30% |
| D6: Structure stop comparison | WR for signals using structure stop (sl_dist 0.4–2.5×ATR) vs ATR fallback | Expected: structure stop improves RR consistency |
| D7: P1.3 boost inflation (90–94 band) | Requires `pre_boost_confidence` field in DB schema first | If 90–94 boosted signals WR < 90–94 non-boosted: lower spot cap from 88→87 |

---

## PART D — Timing: NOW / AFTER JUNE 23 / AFTER 30 DAYS

### NOW (immediately, 2026-06-19)

**Nothing executable remains.** All P0 and P1 changes have been applied. Current state:

| Gate | Status | Verified |
|------|--------|---------|
| high_confidence mode | DISABLED | ✅ |
| probability_gate_v1 WR≥40 | ON | ✅ |
| regime_hard_gate_v2 | ON | ✅ |
| early_breakout_penalty_v1 | ON | ✅ |
| riskgrade_v2 | ON | ✅ |
| FUTURES min_conf | 85 | ✅ |
| TRENDING min_conf | 85 | ✅ |
| Boost inflation cap | base<87→cap@89 | ✅ |
| Grade D backstop | ON | ✅ |

**Monitoring tasks during 2026-06-19 to 2026-06-23:**
1. Check gate_rejections per scan: `probability_send_gate`, `CONTRA_REGIME_REJECTION`, `BUY_EARLY_BREAKOUT` counts must be > 0 (confirms gates are firing)
2. Check empirical_wr of delivered signals: target > 42% avg
3. Check for OI_NEUTRAL signals in delivered feed: must be PASSING (not blocked)
4. Watch for Grade D signals in delivered feed: must be 0

### AFTER JUNE 23 (Day 7 Checkpoint — 2026-06-23)

Run the Recovery Score calculation from LIVE_RECOVERY_MONITOR_1.md §9. Then apply the decision tree:

```
IF Recovery Score ≥ 7.0 AND 7D WR ≥ 33%:
  → CONTINUE. P1 code changes (TRENDING/FUTURES floor raises) already deployed.
  → Begin SIDEWAYS regime gate investigation (C1 above).
  → No further code changes needed until Day 30.

IF Recovery Score 5.0–6.9 AND 7D WR 28–33%:
  → HOLD. Recovery in progress — pre-P0 tail still in 7D window.
  → Investigate which Recovery Score component is lagging.
  → Re-assess at Day 14 (2026-06-30).
  → Do NOT revert any P0 flags.

IF Recovery Score 3.0–4.9 AND delivered < 5 signals/week:
  → PARTIAL REVERT probability gate only: lower min_empirical_wr from 40.0 → 35.0
  → Keep: regime_v2 ON, early_breakout ON, high_conf OFF, riskgrade_v2 ON
  → Investigate attribution_snapshots n coverage (run attribution coverage SQL query)

IF Recovery Score < 3.0 OR WR < 25% declining:
  → FULL REVERT: disable probability_gate_v1
  → Keep all other flags
  → Investigate: attribution_snapshots nightly job, empirical_wr stamping, migrations
```

**OI_NEUTRAL false negative check (mandatory regardless of Recovery Score):**  
Run the false negative SQL query from LIVE_RECOVERY_MONITOR_1.md Appendix B. If any OI_NEUTRAL signals are blocked → lower min_empirical_wr to 35 immediately + investigate attribution_snapshots OI_NEUTRAL row n.

**SIDEWAYS investigation if Recovery Score ≥ 7.0:**  
Query: what was BTC regime on days when 7D WR was collapsing? If SIDEWAYS appears on ≥3 consecutive loss days, implement C1 SIDEWAYS gate in signal_pipeline.py.

### AFTER 30 DAYS (2026-07-16)

1. Run formal gate promotion checks (D1, D2 from Part C above)
2. Evaluate ADX/RSI cohort WR from 30D P0-clean data (D3, D4, D5)
3. Decision on SIDEWAYS gate implementation if Day 7 data was inconclusive
4. P1.3 investigation (D7) — only if `pre_boost_confidence` schema field was added
5. Evaluate whether `min_empirical_wr` should be raised from 40 → 45 (Scenario B → C per SQA3 §12)

---

## PART E — Priority Roadmap

### Priority 1 — TRENDING conf · FUTURES conf · Confidence inflation cap

**All three are COMPLETE as of 2026-06-19.**

| Item | Was | Now | Applied |
|------|-----|-----|---------|
| TRENDING min_confidence | 78 | **85** | 2026-06-19 |
| FUTURES min_confidence | 82 | **85** | 2026-06-19 |
| Boost inflation cap | Uncapped | **base<87 → cap@89** (HIGH_MOMENTUM exempt) | 2026-06-19 |

**Why these were Priority 1:**
- TRENDING 78–84 was entirely in negative-expectancy territory (−0.09R band per ALPHA.TRUTH.1). Trending mode was the most structurally unjustified floor in the system — 7pp below the known negative-expectancy cutoff.
- FUTURES 82–84 was in the same negative-expectancy zone as the pre-fix spot floor that was raised during ALPHA.TRUTH.1.
- The 90–94 band inversion (31.4% WR < 85–89's 42.1%) was caused by boosted-borderline signals. The cap prevents signals at base_conf 82–87 from crossing into the 90–94 black hole via intelligence boosts.

**Current monitoring:** Both floors are now 85 across all active modes. High_confidence mode is disabled. The only remaining structural floor gap is the SIDEWAYS regime (no gate — see Priority 2).

---

### Priority 2 — SIDEWAYS Regime Investigation

**Status: PENDING — waiting for Day 7 data (2026-06-23)**

**What we know:**
- The 7D WR collapse to 20% is 15pp below the 30D average — this exceeds the 12pp anomaly threshold.
- The NULL regime hard gate eliminated the largest-known losing cohort (WR=14.9%).
- Contra-regime BUY (WR=19%) is blocked by regime_hard_gate_v2.
- SIDEWAYS is the only regime with no directional gate. Directional signals (BUY/SELL) in SIDEWAYS have no trend alignment. The 7D collapse pattern is consistent with a BULL_TREND → SIDEWAYS shift ~7 days before 2026-06-16.

**What we need before acting:**
1. Confirm BTC regime was SIDEWAYS on the days with the most losses (query signal_outcomes for losses by market_regime)
2. Quantify: what % of pre-P0 signals had `market_regime = SIDEWAYS`?
3. Confirm: do SIDEWAYS signals have materially lower WR than BULL_TREND signals?

**Implementation if confirmed (after 2026-06-23):**
```python
# In signal_pipeline.py, Step 10.5 (after existing contra_regime_gate call):
def sideways_regime_gate(btc_regime, signal_type, breakout_strength, confidence_boost):
    if btc_regime != 'SIDEWAYS':
        return False  # not applicable
    if breakout_strength == 'HIGH_MOMENTUM_BREAKOUT':
        return False  # override — institutional momentum valid in any regime
    return True  # reject: directional signal in SIDEWAYS without institutional momentum
```

Files: `backend/core/scanner/signal_pipeline.py`, `backend/analytics/scan_metrics.py` (new gate key `SIDEWAYS_REJECTION`)

**Risk:** LOW. The HIGH_MOMENTUM override preserves the best SIDEWAYS breakout signals (same logic as regime V2). Only affects signals without strong breakout confirmation.

---

### Priority 3 — Long-Term Data Collection (Day 30 items)

These are not actionable before 2026-07-16. Monitor passively; do not change configuration.

**Item 3.1: Probability gate formal promotion**  
Collect: resolved signal count with `empirical_wr IS NOT NULL`. Gate: need n≥200 stamped+resolved, MAE≤0.25, drift ±10pp. Currently n=1 at time of audit. At ~15–20 signals/week delivered post-P0, expect n=200 around Day 100 (September 2026). Probability gate is valid empirically before formal promotion — keep ON.

**Item 3.2: Attribution_snapshots coverage expansion**  
The nightly job runs at 00:15 UTC. Each new week of clean P0 signals improves n for each cohort cell. Watch for HIGH_MOMENTUM and OI_NEUTRAL to cross n=30 threshold — at that point the probability gate becomes fully data-backed for these top cohorts.

**Item 3.3: ADX scoring relax evaluation**  
ADX ≥30 → +8 is current. If 30D data shows ADX 30–39 cohort WR is marginal (below 45%), reduce the bonus to +4. If cohort WR is strong (above 50%), keep +8.

**Item 3.4: Intelligence boost decomposition**  
The 90–94 band inversion is solved by the boost inflation cap. But to understand it fully: add a `pre_boost_confidence` field to the signals table to track where the 90–94 band signals originated. This is an analytics improvement, not a production change. Add in a future migration if the Day 30 data shows residual 90–94 issues.

**Item 3.5: Confidence calibration window cleaning**  
The 30D WR figures currently include pre-ALPHA.TRUTH.1 NULL-regime signals in the denominator. As these flush out of the 30D window (by ~2026-07-16), the 30D baseline will become a clean P0 reading. Expected: 30D WR rises from 35% toward 42–47% as NULL-regime contamination drains.

---

## PART F — Things That Should NEVER Be Done

These are permanently off the table. All items are backed by production outcome data. No exceptions without n≥30 new outcome data for that specific cohort.

### F1 — NEVER re-enable `high_confidence` mode without 30+ new outcomes
**Data:** 0/9 wins last 7D. 26.8% WR 30D. −0.196R expectancy. The mode's large-cap selectivity criteria (MCap≥$2B, Vol≥$500M) are not predictive of signal WR. The mode concentrates in the 90–94 confidence band — the system's worst performer (31.4% WR). Enablement criteria: WR ≥ 40% over ≥30 new signals in a clean post-recovery window.

### F2 — NEVER add indicators to `detect_setup()` to solve the 7D WR collapse
**Data:** The WR collapse is caused by regime mismatch, mode configuration, and probability gate being OFF — not by missing indicators. The pipeline already includes RSI divergence, EMA200 counter-trend penalty, ADX scoring, volume gradient, RSI pullback zones, 4h MACD alignment, 4h RSI zones, daily candle patterns, structure-aware stops. Adding more indicators adds false signals. The issue is gate configuration, not detection capability.

### F3 — NEVER lower the NULL regime hard gate
**Data:** NULL regime WR = 14.9%, Exp = −0.543R, N = 677. This is the hardest data point in the entire system. It is also the easiest gate to validate: BTC regime = NULL → reject. No override case has ever been documented. [ALPHA.TRUTH.1]

### F4 — NEVER block OI_NEUTRAL signals
**Data:** OI_NEUTRAL WR = 76.3%, Exp = +1.776R, N = 38. If the probability gate stamps OI_NEUTRAL with empirical_wr < 40% due to stale attribution data, this is a false negative to fix — not a signal to block. OI_NEUTRAL is the highest-documented futures alpha. Blocking it is the single most destructive gate change possible.

### F5 — NEVER use stated confidence > 89 as a quality signal
**Data:** 90–94 actual WR = 31.4% — 10.7pp WORSE than 85–89 (42.1%). Higher stated confidence does not correlate with higher actual WR above 89. A signal at 90 stated confidence has LOWER expected WR than a signal at 87. Any position sizing or alerting system that treats stated confidence 90+ as "highest quality" is making systematically worse decisions. [CONF.CAL.2]

### F6 — NEVER filter by heuristic Grade A as a quality signal
**Data:** Heuristic Grade A = 33.9% WR, below system breakeven of 32.3%. Heuristic Grade C = 56.4% WR. The system is inverted: the "best" heuristic grade is a losing cohort. Use empirical grade (A+/A/B+/B/C/D from `empiricalGrade` field) — these are monotonic with zero inversions at n=1,822. [PERF.VERIF.1]

### F7 — NEVER loosen probability gate below WR ≥ 35% threshold
**Data:** At median 2.1:1 RR, breakeven WR = 32.3%. WR < 35% leaves < 2.7pp margin above breakeven. Any threshold below 35% permits signals with expected negative EV. The pre-recovery baseline (WR=35%, Exp=+0.10R) was itself "below breakeven in practice" due to that thin margin. Only lower under documented PARTIAL REVERT conditions (Recovery Score 3.0–4.9 AND delivered < 5 signals/week — see LIVE_RECOVERY_MONITOR_1.md §10).

### F8 — NEVER trust position_multipliers using heuristic grades
**Data:** `position_multipliers = {A:1.0, B:0.75, C:0.5, D:0.35, F:0.0}` — this is backwards relative to actual heuristic performance (C outperforms A). With `riskgrade_v2=True`, the system now uses empirical grades for sizing. Reverting riskgrade_v2 would restore inverted sizing. [SQA3 §10 Cause 6]

### F9 — NEVER add AI calls for signals with `setup_score < 78`
**Data:** The `AI_MIN_SETUP_SCORE = 78` threshold was established to reduce Claude credits by ~50% while preserving signal quality. The heuristic path for <78 signals is not a quality deficit — it is the correct path. Adding AI to marginal setup scores would increase costs without demonstrably improving WR (the SOL signal at setup_score=77, empirical_grade=D was the clearest example: even Claude would not have changed the Grade D cohort outcome). [TELEGRAM.RELIABILITY.1]

### F10 — NEVER run a 7D audit and make architectural changes without 7D data
**Data:** The 7D window captures at most 1–3 signal resolution cycles per mode. Day-of-week effects, BTC regime changes, and single-mode failures (high_confidence 0/9) can dominate the 7D WR reading. Always confirm with Day 14 and Day 30 data before architectural changes. The P0 fixes were valid exceptions because they were backed by independent 30D audits — not the 7D figure alone.

---

## Summary State Table

| Category | Status | Last Changed | Next Review |
|----------|--------|-------------|-------------|
| Signal generation pipeline | ✅ FULLY CONFIGURED | 2026-06-16 | — |
| Probability gate (WR≥40) | ✅ ON | 2026-06-16 | Day 7 (2026-06-23) |
| Regime hard gate V2 | ✅ ON | 2026-06-16 | Day 30 (2026-07-16) |
| Early breakout penalty | ✅ ON | 2026-06-16 | Day 30 |
| riskgrade_v2 display | ✅ ON | 2026-06-16 | Day 30 (formal promotion) |
| high_confidence mode | ✅ DISABLED | 2026-06-16 | Re-enable requires WR≥40 over ≥30 signals |
| FUTURES min_confidence | ✅ 85 | 2026-06-19 | — |
| TRENDING min_confidence | ✅ 85 | 2026-06-19 | — |
| Boost inflation cap | ✅ base<87→cap@89 | 2026-06-19 | Day 30 |
| Grade D backstop | ✅ ON | 2026-06-19 | — |
| SIDEWAYS regime gate | ⏳ PENDING DATA | — | 2026-06-23 |
| Day 7 Recovery Score | ⏳ COMPUTE | — | 2026-06-23 |
| Formal gate promotions | ⏳ NEEDS N≥200 | — | 2026-07-16 |
| ADX/RSI scoring relax | ⏳ NEEDS 30D DATA | — | 2026-07-16 |

---

*End of SIGNAL_ENGINE_ACTIONS_1.md*  
*No new audits. No new code. Execute and monitor only.*  
*Next action: Day 7 checkpoint 2026-06-23 — compute Recovery Score, assess SIDEWAYS, decide Continue/Hold/Revert.*
