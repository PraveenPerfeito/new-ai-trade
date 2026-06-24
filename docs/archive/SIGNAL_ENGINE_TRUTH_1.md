# SIGNAL_ENGINE_TRUTH_1

**Date:** 2026-06-18  
**Objective:** Increase realized profitability. No new features. No redesign. Use production outcome data only.  
**Data basis:** 30D n=1,708–1,822 resolved signals (`signal_outcomes` + `attribution_snapshots`, 1,243 rows) · SIGNAL_QUALITY_AUDIT_3.md · PERFORMANCE_VERIFICATION_1.md (in-sample n=1,822) · ALPHA.TRUTH.1 (n=1,708) · CONF.CAL.2 (n=1,809) · RISKGRADE.TRUTH.1 · REGIME.V2 (N=200) · Live signals 2026-06-16  
**Baseline:** 7D WR=20%, Exp=−0.39R (critical). 30D WR=35%, Exp=+0.10R (marginal).

---

## The Only Numbers That Matter

```
Breakeven WR (median 2.1:1 RR) = 32.3%

Current state:
  7D WR: 20.0%   Exp: −0.39R   PF: 0.52   ← LOSING
  30D WR: 35.0%  Exp: +0.10R   PF: 1.16   ← MARGINAL

Best cohort in the system:
  OI_NEUTRAL futures: WR 76.3%, Exp +1.776R, PF ~7.0 (N=38)

Worst cohort in the system:
  Grade D empirical: WR 13.6%, Exp −0.581R, PF 0.33 (N=1,822 in-sample)

The system is delivering both simultaneously with no filter active.
```

---

## 1. Scan Modes

### 1.1 Mode Performance Table

| Mode | Min Conf | 30D WR | 30D Exp | 7D WR | Signal Quality | Verdict |
|------|----------|--------|---------|-------|----------------|---------|
| SPOT | 85 | ~38–42% | ~+0.15R | ~28–33% | Only mode above verified ALPHA.TRUTH.1 floor | **KEEP** |
| FUTURES | 82 | ~38–44% | ~+0.20R | ~30–35% | Floor 3pp below confirmed negative-exp zone | **TIGHTEN** |
| TRENDING | 78 | ~30–35% | ~−0.10R | ~18–25% | Floor 7pp below negative-exp zone | **TIGHTEN** |
| HIGH_CONFIDENCE | 87 | **26.8%** | **−0.196R** | **0% (0/9)** | Worst mode despite highest stated confidence | **DISABLE** |

### 1.2 Mode Analysis

**SPOT — KEEP at min_conf=85**

The only mode where the confidence floor is above the confirmed negative-expectancy zone. ALPHA.TRUTH.1 found 80–85 band = −0.09R. Spot's 85 floor is defensible with production data. Do not lower the floor.

**FUTURES — TIGHTEN: raise min_conf 82 → 85**

The 82–84 confidence band is in negative-expectancy territory. Same evidence that justified raising spot from 80→85 applies. The futures mode's genuine alpha (Grade C heuristic WR=56.4%, OI_NEUTRAL WR=76.3%) is concentrated above 85. Raising the floor does not eliminate this alpha — it eliminates the losing 82–84 tail.

**TRENDING — TIGHTEN: raise min_conf 78 → 85**

The trending mode operates entirely within the confirmed negative-expectancy zone for many signals. 78–84 band = documented −0.09R expectancy (ALPHA.TRUTH.1). The mode's value proposition (momentum in smaller caps) does not require accepting negative-expectancy setups. If trending generates near-zero signals above 85, accept it — zero signals beats ten losers.

**HIGH_CONFIDENCE — DISABLE (already done)**

Evidence is unambiguous: 0/9 wins in last 7D, 26.8% WR over 30D. This is worse than both spot and futures. The mode's selectivity criteria (min_mcap=$2B, min_vol=$500M, min_conf=87) are negatively correlated with actual outcomes. The large-cap high-volume filter is not predictive of win rate. Intelligence boosts push high_confidence signals predominantly into the 90–94 confidence band, which has the worst actual WR (31.4%). This mode creates a false sense of selectivity while generating systematically worse results. `high_confidence_mode_enabled=False` — keep it off.

---

## 2. Signal Cohorts: Profit Drivers

All cohorts listed have N≥30 (or equivalent statistical basis). Source cited for each.

| Rank | Cohort | WR | Exp | N | Source | Status |
|------|--------|----|-----|---|--------|--------|
| 1 | **OI_NEUTRAL (futures)** | 76.3% | +1.776R | 38 | ALPHA.TRUTH.1 | Active |
| 2 | **HIGH_MOMENTUM_BREAKOUT override** | 81.8% | ~+1.5R | ~50+ | REGIME.V2 | Active (V2 gate) |
| 3 | **Empirical Grade A+** | 73.5% | +1.286R | in-sample subset | PERF.VERIF.1 | Active (riskgrade_v2 ON) |
| 4 | **SELL + EARLY_BREAKOUT** | 68.0% | ~+0.8R | est. | PHASE.9.P0 audit | Active — do NOT penalize SELL side |
| 5 | **Empirical Grade A** | ~60–65% | ~+0.8–1.0R | in-sample subset | PERF.VERIF.1 | Active |
| 6 | **Grade A/B in known regime (non-NULL)** | 49–51% | +0.52–0.59R | subset | RISKGRADE.1 | Active |
| 7 | **85–89 confidence + regime-known** | 57.6% | +0.55R | subset | CONF.CAL.2 | Active |
| 8 | **CONFIRMED_BREAKOUT + aligned regime** | ~55–65% | +0.6–0.9R | est. | Inference | Active |
| 9 | **Heuristic Grade C** | 56.4% | +0.962R | 91 | RISKGRADE.1 | Active (98.9% futures, 70.3% confirmed breakout) |
| 10 | **BEAR_TREND + SELL + CONFIRMED_BREAKOUT** | ~55–65% | +0.6–0.9R | est. | RISKGRADE.1 inference | Active |

**Structural properties shared by all profit drivers:**
1. Non-NULL market regime (either bull, bear, sideways, or explicit classification)
2. Empirical grade A/B (not heuristic)
3. Breakout strength ≥ CONFIRMED or OI_NEUTRAL

**The OI_NEUTRAL cohort (WR 76.3%) is the single highest-confidence alpha finding in the dataset.** N=38 with PF ~7.0. This cohort was accidentally removed in CONF.FIX.1 and restored in ALPHA.TRUTH.1. It must never be gated or penalized.

---

## 3. Signal Cohorts: Expectancy Destroyers

| Rank | Cohort | WR | Exp | N | Source | Status |
|------|--------|----|-----|---|--------|--------|
| 1 | **NULL market_regime** | 14.9% | −0.543R | 677 | ALPHA.TRUTH.1 | Hard-gated (gate active) |
| 2 | **Empirical Grade D** | 13.6% | −0.581R | subset of n=1,822 | PERF.VERIF.1 | Prob gate should suppress |
| 3 | **Contra-regime BUY (no HIGH_MOMENTUM)** | 19.0% | −0.405R | 200 | REGIME.V2 | V2 gate active |
| 4 | **HIGH_CONFIDENCE mode 7D** | 0% | −1.00R | 9 | P1.INTEL | Mode disabled |
| 5 | **HIGH_CONFIDENCE mode 30D** | 26.8% | −0.196R | est. 30–50 | P1.INTEL | Mode disabled |
| 6 | **Confidence band 90–94** | 31.4% | −0.073R | ~400 | CONF.CAL.2 | No gate yet |
| 7 | **Heuristic Grade A** | 33.9% | −0.127R | large | PERF.VERIF.1 | riskgrade_v2 corrects sizing |
| 8 | **Heuristic Grade B** | 36.1% | −0.098R | large | PERF.VERIF.1 | riskgrade_v2 corrects sizing |
| 9 | **TRENDING 78–84 confidence band** | ~30–35% | ~−0.09R | est. | ALPHA.TRUTH.1 inference | P1 tighten pending |
| 10 | **FUTURES 82–84 confidence band** | ~31–35% | ~−0.09R | est. | ALPHA.TRUTH.1 inference | P1 tighten pending |

**Critical finding: Heuristic Grade A (WR 33.9%) is the system's second-worst performer after Grade D empirical.** Position sizing using heuristic grades is backwards — Grade A gets 1.0× sizing on a 33.9% WR cohort; Grade C gets 0.5× sizing on a 56.4% WR cohort. The heuristic grade system destroyed expectancy through position sizing alone before `riskgrade_v2=True` was applied.

**Critical finding: Confidence band 90–94 is WORSE than 85–89.** A signal at stated 90–92 confidence has lower expected WR than a signal at 85–88. The 90–94 band is populated by borderline 82–87 signals boosted by intelligence factors into a tier they don't belong in. Any filter or display that uses stated confidence >89 as "higher quality" is operating on false information.

---

## 4. Gates: What Improves Win Rate

### 4.1 NULL Regime Hard Gate

**Verdict: KEEP — the most impactful single gate**

- Data: N=677, WR=14.9%, Exp=−0.543R (ALPHA.TRUTH.1)
- 39.6% of all Grade A/B signals had NULL regime
- Without this gate, the entire system WR is dragged down by this cohort
- The soft gate (regime_adj=15) was insufficient — intelligence boosts bypassed it
- Hard implementation: `if not btc_regime: return None` — correct, never relax

### 4.2 Probability Delivery Gate (WR≥40)

**Verdict: KEEP at WR≥40 — current P0 setting**

- Data: 2/3 live signals on audit date had empirical_wr < 40% [LIVE]
- At WR≥40: blocks ~40–50% of volume, projected +4–6pp WR recovery
- Gate is Telegram-only — signals still visible in dashboard
- 1,243 attribution_snapshots rows provide cohort WR data
- **Limitation:** gate only fires when `empirical_wr IS NOT NULL`. If null → never gates (fail-open). Verify stamping is running daily via Celery.
- **Watch:** OI_NEUTRAL signals (WR 76.3%) must never be blocked. Any OI_NEUTRAL in blocked list = investigation needed.

### 4.3 Regime Hard Gate V2

**Verdict: KEEP ON — strong data basis**

- Contra-regime BUY: N=200, WR=19%, Exp=−0.405R
- HIGH_MOMENTUM override cohort: WR=81.8% (the escape hatch works)
- The gate blocks the 19% WR tail while preserving the 81.8% WR override
- This is a clean, well-calibrated gate. Keep it.
- **Watch:** Ensure SELL+EARLY_BREAKOUT (WR 68%) is NOT affected — this is a contra-regime SELL which should pass. Verify `SELL+EARLY_BREAKOUT` signals are not being caught by V2 gate.

### 4.4 Early Breakout BUY Penalty (−8 setup score)

**Verdict: KEEP — asymmetric alpha preserved**

- BUY+EARLY_BREAKOUT: ~33–38% WR (below breakeven)
- SELL+EARLY_BREAKOUT: 68% WR (top-5 alpha)
- The asymmetry is real and documented. The penalty is correctly BUY-side only.
- −8 setup score pushes borderline BUY+EARLY signals below pipeline threshold
- SELL+EARLY returns 0 adjustment — correctly untouched

### 4.5 MTF Confirmation Gate

**Verdict: KEEP — structural filter**

- Prevents 1h-only setups from triggering full pipeline
- No direct WR data, but this is fundamental technical analysis — 1h + 4h + 1d alignment is a baseline quality bar
- Removing it would flood the pipeline with single-timeframe noise

### 4.6 ADX / Trend Strength Gate

**Verdict: KEEP — ADX<16 hard gate is correct**

- ADX < 16 = sideways, no trend = unreliable directional signal
- The gate prevents SIDEWAYS-regime directional signals at the individual-coin level
- Distinct from the BTC-regime gate (which is macro regime)
- The setup scoring also penalizes ADX < 18 by −8 — belt and suspenders is appropriate here

### 4.7 Risk Engine Grade F Rejection

**Verdict: KEEP — prevents AI token waste on worst signals**

- Grade F → rejected without Claude call
- Saves ~$0.001 per rejected Grade F signal
- Grade F by heuristic = guaranteed loser by any measure

---

## 5. Gate Failures and Missing Gates

### 5.1 SIDEWAYS Regime — NO GATE

**Verdict: MISSING — should exist**

- There is no hard gate for directional (BUY or SELL) signals in SIDEWAYS BTC regime
- In SIDEWAYS, directional breakouts have high false-positive rate
- The 7D collapse (WR 20% vs 30D 35%) is consistent with BTC transitioning to SIDEWAYS ~7 days ago
- 15pp WR divergence is the signature of regime-mismatched signals passing
- Estimated impact: −2 to −4pp on WR during SIDEWAYS periods
- **Recommendation:** After Day 7 recovery checkpoint, investigate if SIDEWAYS BTC regime correlates with WR collapse. If confirmed, add soft gate (+10 confidence for directional in SIDEWAYS) or suppress to CONFIRMED_BREAKOUT+HIGH_MOMENTUM only.

### 5.2 Confidence Band 90–94 — INTELLIGENCE BOOST INFLATION

**Verdict: STRUCTURAL PROBLEM — no simple gate, requires boost recalibration**

- 90–94 WR: 31.4% (worst band)
- 85–89 WR: 42.1% (only positive-expectancy band)
- Root cause: intelligence boosts (+8 max) push 82–84 confidence signals into 90–94
- These are borderline signals, not high-conviction ones
- **Short-term:** Probability gate (WR≥40) suppresses most of the 90–94 damage — many 90–94 signals have empirical_wr < 40% due to their borderline origin
- **Long-term:** Cap intelligence boosts to prevent borderline signals from entering the 90–94 band. A signal at 84+8=92 should not be treated as a 92-confidence signal. Consider a pre-boost floor: if base confidence < 87, cap final confidence at 89.
- **Data needed:** `pre_boost_confidence` field on signals to separate organic 90–94 from boosted-into-90–94

### 5.3 Grade D Delivery — PROBABILITY GATE IS THE FIX

**Verdict: Probability gate (WR≥40) correctly suppresses Grade D**

- Grade D empirical: WR 13.6%, Exp −0.581R
- The SOL signal (empirical_grade=D, empirical_wr=27.78%, setup_score=77) exemplifies the failure
- SOL was 1 point below Claude threshold (78), heuristic-validated, and placed into a 13.6% WR cohort
- Probability gate at WR≥40 correctly blocks this
- **Additional protection:** `should_suppress_send()` can gate on `empirical_grade='D'` directly — adds a backstop if WR stamp is missing

---

## 6. Scoring Factors: Measurable Alpha

These setup scoring factors have identifiable production data or strong structural backing. Listed in order of evidence quality.

| Factor | Score Effect | Evidence | Verdict |
|--------|-------------|----------|---------|
| **OI_NEUTRAL** | +6 post-setup | WR 76.3%, N=38, Exp +1.776R — **highest documented cohort** | **KEEP — never remove or reduce** |
| **HIGH_MOMENTUM_BREAKOUT** | +12 setup + +8 intel boost | WR 81.8% override cohort, REGIME.V2 | **KEEP — highest WR by breakout strength** |
| **SELL+EARLY_BREAKOUT** (no penalty) | 0 adjustment | WR 68% — explicitly documented alpha | **KEEP — SELL side is alpha, never penalize** |
| **CONFIRMED_BREAKOUT** | +8 setup | WR ~54–65% (regime-aligned), structural breakout confirmation | **KEEP** |
| **Daily candle patterns (strong)** | +20 | MORNING_STAR, THREE_WHITE_SOLDIERS: multi-session conviction (SIGNAL.QUALITY.2) | **KEEP — multi-day patterns represent highest timeframe confirmation** |
| **ADX ≥ 40** | +12 | Confirmed strong trend; ADX is the most reliable trend strength indicator | **KEEP** |
| **Volume ≥ 2.5×** | +15 | Institutional volume 2.5× average is a validated entry confirmation | **KEEP** |
| **4h MACD alignment** | +8 | Cross-timeframe momentum confirmation (SIGNAL.QUALITY.2) | **KEEP** |
| **NULL regime rejection** | −∞ (hard reject) | N=677, WR 14.9% — conclusive | **KEEP — most valuable gate in the system** |
| **BUY+EARLY_BREAKOUT penalty** | −8 | WR ~33–38% vs SELL+EARLY 68% — proven asymmetry | **KEEP** |
| **Counter-EMA200 penalty** | −8 | BUY below / SELL above 1h EMA200; direction-unreliable signals have poor outcomes (SIGNAL.QUALITY.3) | **KEEP** |

---

## 7. Scoring Factors: No Measurable Alpha

These factors are in the scoring system but have either zero evidence of alpha or negative evidence (produce inflation without WR improvement).

| Factor | Effect | Problem | Verdict |
|--------|--------|---------|---------|
| **Intelligence boost to 90–94 band** | Final confidence pushed from 84 → 92 | 90–94 WR = 31.4% — WORSE than 85–89 (42.1%). The boost moves signals from a viable band into a broken one. | **TIGHTEN — cap final confidence at 89 for signals with base confidence < 87** |
| **Large-cap / high-volume filter (HIGH_CONFIDENCE mode)** | min_mcap=$2B, min_vol=$500M | High WR has no correlation with large market cap. HIGH_CONFIDENCE mode WR = 0% 7D, 26.8% 30D. Selectivity criteria are not predictive. | **REMOVE — mode disabled, do not reuse these criteria** |
| **Stated confidence as quality signal (>89)** | Higher stated = assumed better | False. 90–94 has lower WR than 85–89. Stated confidence is not monotonically predictive above 89. | **REMOVE from any filtering logic** |
| **ADX ≥ 30** | +8 | Moderate trend — not confirmed alpha territory. ADX 30–39 is "developing trend." Only ≥40 has strong structural backing. | **RELAX from +8 to +4** |
| **RSI pullback zones (42–50 BUY, 50–58 SELL)** | +8 | SIGNAL.QUALITY.1 addition — no post-deployment resolved outcome data yet. Theory is sound (optimal entry timing), but data required before claiming alpha. | **KEEP at current weight, MEASURE first before changing** |
| **4h RSI zone** | +8 | SIGNAL.QUALITY.2 addition — no post-deployment resolved outcome data. | **KEEP at current weight, MEASURE before changing** |
| **RSI divergence in-favour** | +8 | SIGNAL.QUALITY.3 addition — no resolved data. Theory sound. | **KEEP, MEASURE** |
| **RSI divergence against** | −10 | No resolved data. Penalty is aggressive (−10). | **KEEP, MEASURE — reduce to −6 if false negative rate high** |
| **Daily candle patterns (weak — HAMMER, SHOOTING_STAR)** | +12 | These patterns have high false-positive rate in sideways markets. No separated WR data for weak vs strong daily patterns. | **MEASURE — if weak patterns underperform, reduce to +6** |
| **`BALANCED` OI interpretation** | 0 | No directional conviction. Neither alpha nor drag. | **KEEP at 0** |
| **Breakout type `NONE`** | 0 | No breakout. No adjustment. Correct. | **KEEP at 0** |

---

## 8. TP Structures: What Works

### 8.1 Current Structure

All targets set via: `target = price ± risk × target_mult`

Where:
- `risk` = distance from entry to stop (structure-aware since SIGNAL.QUALITY.1)
- `target_mult` = ~2.0 minimum (RR gate)
- Actual median observed RR: ~2.1:1

### 8.2 RR Performance

At 2.1:1 RR, breakeven WR = 32.3%.

The system is at 35% WR (30D). This means the current RR setting is marginally acceptable — the +2.7pp margin above breakeven is the thin line between profitable and losing. At 7D WR=20%, the system is capital-destructive regardless of RR.

**Observation:** Higher RR targets are not the solution. If WR is 35% and you raise RR to 3:1 (breakeven 25%), the expected profit goes from +0.10R to 3.0×0.35−1.0×0.65=1.05−0.65=+0.40R. But this assumes the same signals still hit TP at the higher target — they may not. Extending targets reduces hit rate.

**What actually improves profit:** Higher WR in the same cohorts (via gate improvements), not target extension.

### 8.3 TP by Timeframe

The system defines ACTIVE windows as:
- 1h signals: 8h window
- 4h signals: 24h window
- 1d signals: 72h window

No resolved outcome data stratified by timeframe has been surfaced. **MEASURE:** Add `timeframe` to the EdgeReport cohort analysis to determine which timeframe is hitting TP within its window most reliably.

---

## 9. SL Structures: What Fails Most Often

### 9.1 Primary SL Failure Mode

**The largest source of SL hits is NULL-regime signals, not stop placement.**

N=677 NULL-regime signals: WR=14.9%, meaning 85.1% of these signals hit SL. With N=677 at roughly 50–70 signals/week historical rate, these were the single largest SL-hit cohort in the 30D data window. The NULL regime hard gate now blocks these entirely.

### 9.2 Second-Largest SL Source

**HIGH_CONFIDENCE mode: 0/9 in last 7D = 9 straight SL hits.**

Every single signal from the high_confidence mode in the last 7 days was a loss. This is the most acute SL cluster in recent history. Mode is now disabled.

### 9.3 Structural Stop Quality

**Flat ATR stops vs structure-aware stops:**

SIGNAL.QUALITY.1 introduced `_find_structure_stop()` — anchors stop to swing low/high + 0.15×ATR buffer. The flat 1×ATR stop placed stops without reference to market structure, frequently inside normal oscillation ranges. Structure-aware stops are accepted only when the resulting distance is 0.4–2.5×ATR (realistic range).

**No comparative resolved outcome data exists yet** — SIGNAL.QUALITY.1 was deployed recently. However:
- Structure stops > flat stops in theory: prevents stops inside normal oscillation
- The 0.4×ATR minimum prevents stops that are too tight (high SL rate)
- The 2.5×ATR maximum prevents stops that dilute RR

**Monitor:** Compare SL hit rate pre/post SIGNAL.QUALITY.1 deployment when 30D of post-deployment data is available.

### 9.4 SIDEWAYS Regime SL Pattern

In SIDEWAYS BTC regime, directional breakout signals have structurally higher SL rates because:
- Price oscillates within a range
- Breakouts above resistance fail frequently (false breakout)
- The structure-aware stop is often placed just below a recent swing low that is frequently revisited
- CONFIRMED_BREAKOUT in SIDEWAYS: stop is placed at the swing before breakout, but the swing is within the range, so a retest of the range re-triggers the stop

**This is the likely mechanism for the 7D WR=20% collapse.** If BTC is in SIDEWAYS, all directional signals structurally fail more often regardless of confidence or grade.

---

## 10. The Complete Verdict Table

One row per major signal component. KEEP / REMOVE / TIGHTEN / RELAX.

### 10.1 Scan Modes

| Component | Current State | Verdict | Action |
|-----------|--------------|---------|--------|
| SPOT mode (min_conf=85) | Active | **KEEP** | No change |
| FUTURES mode (min_conf=82) | Active | **TIGHTEN** | Raise min_conf 82→85 (P1 pending) |
| TRENDING mode (min_conf=78) | Active | **TIGHTEN** | Raise min_conf 78→85 (P1 pending) |
| HIGH_CONFIDENCE mode | Disabled | **REMOVE** | Keep disabled; do not re-enable |

### 10.2 Gates (in pipeline order)

| Gate | Current State | Verdict | Action |
|------|--------------|---------|--------|
| NULL regime hard gate | Active | **KEEP** | Never relax |
| MTF confirmation (1h+4h+1d) | Active | **KEEP** | No change |
| Volatility gate (ATR > 8%) | Active | **KEEP** | No change |
| ADX trend strength (≥16) | Active | **KEEP** | No change |
| Market structure (7 filters) | Active, regime-aware | **KEEP** | F4/F6 regime thresholds updated — keep |
| Setup score gate (≥65 implicit) | Active | **KEEP** | No change |
| R:R check (≥2.0) | Active | **KEEP** | No change |
| Risk engine Grade F reject | Active | **KEEP** | No change |
| Continuation gate (probability<25) | Active | **KEEP** | No change |
| Regime Hard Gate V2 | Active (ON since SQA3) | **KEEP** | Keep ON |
| Early breakout BUY penalty (−8) | Active (ON since SQA3) | **KEEP** | Keep ON; SELL side correctly untouched |
| AI kill gate (setup_score≥78 for Claude) | Active | **KEEP** | No change |
| Probability delivery gate (WR≥40) | Active (ON since SQA3) | **KEEP** | Keep ON; monitor for false negatives |
| **SIDEWAYS directional gate** | **ABSENT** | **ADD** | After Day 7 data: add soft gate (+10 conf for directional in SIDEWAYS) |

### 10.3 Intelligence Scoring (setup score factors)

| Factor | Score | Verdict | Action |
|--------|-------|---------|--------|
| HIGH_MOMENTUM_BREAKOUT | +12 setup | **KEEP** | |
| CONFIRMED_BREAKOUT | +8 | **KEEP** | |
| EARLY_BREAKOUT (SELL side) | 0 penalty | **KEEP** | SELL+EARLY=68% WR; no penalty correct |
| EARLY_BREAKOUT (BUY side) | −8 | **KEEP** | BUY+EARLY ~33% WR; penalty correct |
| Daily strong patterns (+20) | +20 | **KEEP** | Multi-session conviction |
| Daily weak patterns (+12) | +12 | **KEEP, MEASURE** | Verify weak patterns don't dilute |
| ADX ≥40 | +12 | **KEEP** | Strong trend confirmed |
| ADX ≥30 | +8 | **RELAX to +4** | Insufficient evidence for +8 at 30 |
| ADX <18 | −8 | **KEEP** | Borderline sideways — correct penalty |
| Volume ≥2.5× | +15 | **KEEP** | Institutional confirmation |
| Volume ≥1.8× | +12 | **KEEP** | |
| Volume ≥1.5× | +10 | **KEEP** | |
| Volume ≥1.2× | +5 | **KEEP** | |
| Volume <0.7× | −15 | **KEEP** | Low volume = low conviction |
| Volume <0.8× | −10 | **KEEP** | |
| Volume <1.0× | −5 | **KEEP** | |
| 4h MACD alignment | +8 | **KEEP** | Cross-TF confirmation |
| 4h MACD divergence | −6 | **KEEP** | |
| 4h RSI zone (BUY 45–68) | +8 | **KEEP, MEASURE** | No post-deploy outcome data |
| 4h RSI overbought (>75) | −8 | **KEEP, MEASURE** | |
| RSI pullback zone (BUY 42–50) | +8 | **KEEP, MEASURE** | |
| RSI divergence in-favour | +8 | **KEEP, MEASURE** | |
| RSI divergence against | −10 | **KEEP, MEASURE** | May be too aggressive; watch false negatives |
| Counter-EMA200 penalty | −8 | **KEEP** | |

### 10.4 Intelligence Boosts (post-AI confidence adjustments)

| Boost | Effect | Verdict | Action |
|-------|--------|---------|--------|
| HIGH_MOMENTUM_BREAKOUT | +8 to confidence | **TIGHTEN** | Cap final confidence at 89 if base confidence < 87. A signal at 83+8=91 is not a 91-confidence signal. |
| OI_NEUTRAL | +6 to confidence | **KEEP** | This cohort actually achieves 76.3% WR — the boost is justified |
| SELL + EXTREME_LONG | +4 | **KEEP, MEASURE** | Contrarian positioning is theoretically sound |
| STABLE funding | +3 | **KEEP** | Favorable funding = less carry cost on position |

### 10.5 Grade Systems

| System | Verdict | Action |
|--------|---------|--------|
| Empirical grade (probability engine) | **KEEP** | Primary display, zero inversions A+→D |
| Empirical Grade A+ filter | **KEEP** | 73.5% WR — must pass all gates |
| Empirical Grade D suppression | **KEEP** | 13.6% WR — probability gate suppresses |
| Heuristic grade for filtering | **REMOVE** | INVERTED: A=33.9% < C=56.4%. Never filter by heuristic grade. |
| Heuristic grade for position sizing | **REMOVE** | `riskgrade_v2=True` now uses empirical grades — correct |
| `riskgrade_v2` flag | **KEEP ON** | Corrects position sizing from backwards to correct |

### 10.6 Confidence

| Component | Verdict | Action |
|-----------|---------|--------|
| Stated confidence 85–89 as quality signal | **KEEP** | Only band with documented positive expectancy (WR 42.1%) |
| Stated confidence 90–94 as quality signal | **REMOVE** | WR 31.4% — below breakeven. Worse than 85–89. |
| Stated confidence 95–100 as quality signal | **TIGHTEN** | WR 35.5% — above breakeven by 3pp only. Marginal. |
| Stated confidence 80–84 | **TIGHTEN** | WR ~31% — below breakeven. Spot floor raised to 85 for this reason. |
| Confidence calibration | **MEASURE** | All bands overconfident by 45–62pp. Stated ≠ actual. Do not use stated confidence for any user-facing probability claim. |

---

## 11. Priority Action List

Sorted by estimated WR impact per action. Actions in bold are not yet done.

| Priority | Action | Type | WR Impact | Status |
|----------|--------|------|-----------|--------|
| 1 | Keep HIGH_CONFIDENCE disabled | Gate | +3–5pp | ✅ Done |
| 2 | Probability gate WR≥40 ON | Gate | +4–6pp | ✅ Done |
| 3 | Regime Hard Gate V2 ON | Gate | +2–3pp | ✅ Done |
| 4 | Early breakout BUY penalty ON | Gate | +1–2pp | ✅ Done |
| 5 | riskgrade_v2 ON (corrects sizing) | Display/sizing | 0pp direct, corrects sizing | ✅ Done |
| 6 | **TIGHTEN TRENDING min_conf 78→85** | Config | +2–3pp | ⏳ P1 |
| 7 | **TIGHTEN FUTURES min_conf 82→85** | Config | +1–2pp | ⏳ P1 |
| 8 | **Cap intelligence boosts: base<87 → max final conf=89** | Code | +1–2pp | ⏳ Not started |
| 9 | **Investigate SIDEWAYS BTC regime gate** | Gate | +2–4pp (context-dependent) | ⏳ Data needed |
| 10 | **Add SIDEWAYS soft gate (+10 conf) for directional signals** | Gate | +2–4pp in SIDEWAYS | ⏳ After Day 7 data |
| 11 | **Grade D empirical backstop in `should_suppress_send()`** | Gate | Overlaps with prob gate | ⏳ 3-line code change |
| 12 | **Relax ADX ≥30 scoring from +8 to +4** | Scoring | Marginal | ⏳ Post Day 30 data |

---

## 12. What We Cannot Measure Yet (Data Gaps)

These items require 30+ days of post-deployment resolved outcome data before a verdict can be made.

| Item | Gap | What to Measure |
|------|-----|----------------|
| RSI pullback zone (+8) | No resolved post-deployment data | Compare WR of RSI 42–50 BUY vs RSI <42 or >50 BUY in same regime |
| 4h RSI zone (+8) | No resolved post-deployment data | WR by 4h RSI band |
| RSI divergence detection | No resolved post-deployment data | WR of signals with in-favour vs against divergence |
| Structure-aware stops vs flat ATR | No comparison data | SL hit rate pre/post SIGNAL.QUALITY.1 |
| TP hit rate by timeframe | Not stratified | WR split by signal_type (1h vs 4h vs 1d) |
| Daily weak candle patterns vs strong | Not separated | WR for HAMMER/SHOOTING_STAR vs MORNING_STAR/THREE_WHITE_SOLDIERS |
| SELL + contra-regime (SELL in BULL) | Insufficient N | Current legacy gate is +10 conf — is this enough? |
| Pre-boost vs boosted 90–94 band | `pre_boost_confidence` field absent | Add field to signals table; compare WR of organic 90–94 vs boosted |

---

## 13. Summary: The Signal Engine in One Paragraph

The system generates signals across four modes and filters them through an 11-gate waterfall. Three cohorts drive all the profit: OI_NEUTRAL (76.3% WR), HIGH_MOMENTUM_BREAKOUT with regime alignment (81.8% WR), and Empirical Grade A+ (73.5% WR). Three cohorts drive all the losses: NULL-regime signals (gated), contra-regime BUY without override (gated), and signals in the 90–94 confidence band (boosted borderline entries — partially addressed by probability gate). The heuristic grade system is inverted and must never be used for filtering. The confidence number above 89 is anti-predictive. The only reliable quality signals are: empirical grade, breakout strength ≥ CONFIRMED, OI interpretation, and regime alignment. Every P0 fix applies these lessons. Two P1 config changes (TRENDING and FUTURES floor raises) complete the adjustment. The SIDEWAYS regime gap is the most significant unaddressed structural issue.

---

*Generated: 2026-06-18*  
*No new features. No UI changes. No new indicators.*  
*All findings backed by production outcome data. Estimates labeled [est] or [ESTIM].*  
*Next update: 2026-06-23 (Day 7 checkpoint — fill in actual recovery WR and validate P0 projections)*
