# SIGNAL ENGINE MASTER
<!-- Consolidated from: SIGNAL_ENGINE_TRUTH_1, SIGNAL_ENGINE_ACTIONS_1, SIGNAL_QUALITY_AUDIT_3, SIGNAL_QUALITY_END_TO_END_VALIDATION_1, SIDEWAYS_REGIME_DECISION_1, VOLUME_QUALITY_BALANCE_1, SIDEWAYS_EXEMPTION_1, ALPHA_MONITORING_1 -->
<!-- Last updated: 2026-06-23 · Authoritative source for signal pipeline, gates, scoring, and decisions -->

---

## SECTION 1 — Signal Pipeline Gates (ordered, all active)

| Step | Gate | Code Location | Reject On | Gate Key |
|------|------|---------------|-----------|----------|
| Pre | **NULL regime hard gate** | `signal_pipeline.py` | `btc_regime is None` | `REGIME_REJECTION` |
| 1 | KLINE fetch | `scan_coin()` Step 1 | All TFs empty / <60 candles | `KLINE_EMPTY`, `KLINE_PARTIAL` |
| 2 | MTF alignment | `signal_pipeline.py` | 1h+4h+1d not aligned | `MTF_REJECTION` |
| 3 | Volatility | `signal_pipeline.py` | Volatility out of range | `VOLATILITY_REJECTION` |
| 4 | Trend strength | `signal_pipeline.py` | ADX / trend too weak | `TREND_STRENGTH_REJECTION` |
| 5 | Market structure (7 filters) | `market_structure.py` | Any sub-condition fires | `ms_*` keys |
| 6 | Setup score | `detect_setup()` | Score below threshold | `SETUP_REJECTION` |
| 7 | RR check | `signal_pipeline.py` | RR < min_rr_ratio | `RR_REJECTION` |
| 8 | Risk engine (grade) | `risk.py` | Grade F or grade backstop | `RISK_REJECTION` |
| 9 | Futures intelligence | `futures_intelligence.py` | FUTURES/HIGH_CONFIDENCE modes only | — |
| 10 | Continuation gate | `continuation.py` | continuationProbability < 25 | — |
| 10.5 | Contra-regime gate v2 | `signal_pipeline.py` | BUY in BEAR/CAPITULATION unless HIGH_MOMENTUM or aligned OI | `CONTRA_REGIME_REJECTION` |
| 10.5.5 | **SIDEWAYS gate** | `signal_pipeline.py` | BUY/SELL in SIDEWAYS unless HIGH_MOMENTUM or CONFIRMED_BREAKOUT | `SIDEWAYS_REJECTION` |
| 11 | AI / heuristic | `ai_validator.py` | ai.enabled=True and setup_score < 78 → heuristic; Claude rejects | `CONFIDENCE_REJECTION` |
| 12 | Confidence floor | `signal_pipeline.py` | confidence < 85 (mode-specific) | `CONFIDENCE_REJECTION` |
| Delivery | **Probability gate** | `telegram_notifier.py` | Cohort WR < 40% in attribution_snapshots | Delivery-only suppression |

**SIDEWAYS gate code (Step 10.5.5, committed June 23):**
```python
# backend/core/scanner/signal_pipeline.py
if btc_regime == "SIDEWAYS" and setup.breakout_strength not in (
    "HIGH_MOMENTUM_BREAKOUT", "CONFIRMED_BREAKOUT"
):
    gate_rejections["SIDEWAYS_REJECTION"] = gate_rejections.get("SIDEWAYS_REJECTION", 0) + 1
    return None
```

---

## SECTION 2 — Regime Truth (30D, n=2,127 resolved)

| Regime | n | WR | Expectancy | PF | Gate Status |
|--------|---|----|------------|-----|-------------|
| BEAR_TREND | 992 | 51.4% | +0.619R | 2.27 | No gate (profitable) |
| **SIDEWAYS** | **364** | **30.2%** | **−0.017R** | **0.986** | HARD GATE (Step 10.5.5, Jun 23) |
| BULL_TREND | 97 | 21.7% | −0.330R | 0.579 | Soft gate only (+10 conf) — P1 gate planned |
| NULL regime | 677 | ~14.9% | ~−0.543R | — | HARD GATE (ALPHA.TRUTH.1, Step Pre) |
| HIGH_VOLATILITY / EUPHORIA / CAPITULATION | 0 | — | — | — | Insufficient data |

**Key finding:** BEAR_TREND (51.4% WR) is the platform's primary profitable regime (68.4% of regime-known signals). All other regimes are losing or gated. Platform edge is structurally concentrated in BEAR_TREND.

**Breakeven WR at 2.1:1 median RR: 32.3%**

### SIDEWAYS gate data basis (June 23)
SIDEWAYS: n=361, WR=30.47%, PF=0.986, Exp=−0.009R — all 3 negative-expectancy criteria triggered.
Volume impact: −22.4% of non-NULL signals/month (~325/month blocked).
WR impact: +4.0pp estimated (removal of PF<1 cohort from PF>2 pool).

### CONFIRMED_BREAKOUT exemption (SIDEWAYS.EXEMPTION.1, commit `d0f949a`)
SIDEWAYS|SELL|CONFIRMED_BREAKOUT: n=61, WR=45.9%, Exp=+0.418R — above 40% probability threshold.
Signal meaning: breakout ABOVE 30D resistance = exiting the range — qualitatively distinct from in-range directional signals.
POSTFIX.1 check (June 30): WR ≥ 40% on n≥10 resolved from this cohort post-exemption.

---

## SECTION 3 — Feature Flags Applied (June 16 — P0 Package)

All 5 flags applied June 16. All remain frozen through June 30 monitoring window.

| Flag | Before | After | Data Basis |
|------|--------|-------|-----------|
| `high_confidence_mode_enabled` | ON | **OFF** | 0/9 wins 7D, 26.8% WR 30D, 74 signals consumed |
| `regime_hard_gate_v2` | OFF | **ON** | Contra-regime BUY WR=19%, Exp=−0.405R; HIGH_MOMENTUM override WR=81.8% |
| `early_breakout_penalty_v1` | OFF | **ON** | BUY+EARLY_BREAKOUT unpenalized → negative expectancy cohort |
| `probability_gate_v1` | OFF | **ON** | 2/3 live signals were in WR<40% cohorts at audit |
| `riskgrade_v2` | OFF | **ON** | Heuristic A(33.9%) < B(36.1%) < C(56.4%) inverted; empirical: zero inversions |

**Probability gate config:** `min_empirical_wr=40.0`. Uses 5-level hierarchy: `regime|type|breakout` → `regime|type` → `regime` → `conf_band` → `global` (n≥30/level). Fails open (unknown cohort → deliver).

**P1 changes (June 19):**
- FUTURES min_confidence: 82 → 85
- TRENDING min_confidence: 78 → 85
- Boost inflation cap added
- Grade D backstop: now uses regime-level cohort only (was global cohort — previously blocked ALL alerts June 15–19)

---

## SECTION 4 — Setup Scoring Factors (detect_setup())

All factors active in `backend/core/scanner/signal_pipeline.py`:

| Factor | Condition | Score |
|--------|-----------|-------|
| ADX trend strength | ≥40 | +12 |
| ADX | ≥30 | +8 |
| ADX | 0 < adx < 18 | −8 |
| Volume spike | ≥2.5× | +15 |
| Volume spike | ≥1.8× | +12 |
| Volume spike | ≥1.5× | +10 |
| Volume spike | ≥1.2× | +5 |
| Volume spike | <0.7× | −15 |
| Volume spike | <0.8× | −10 |
| Volume spike | <1.0× | −5 |
| RSI pullback BUY | 42–50 | +8 |
| RSI pullback SELL | 50–58 | +8 |
| 4h MACD alignment | Direction matches signal | +8 |
| 4h MACD divergence | Direction opposes signal | −6 |
| 4h RSI zone BUY | 45–68 | +8 |
| 4h RSI zone BUY | >75 (overbought) | −8 |
| 4h RSI zone SELL | 32–55 | +8 |
| 4h RSI zone SELL | <25 (oversold) | −8 |
| Daily candle BUY | MORNING_STAR / THREE_WHITE_SOLDIERS | +20 |
| Daily candle SELL | EVENING_STAR / THREE_BLACK_CROWS | +20 |
| Daily candle (weaker reversals) | HAMMER, SHOOTING_STAR, etc. | +12 |
| RSI divergence | Against signal direction | −10 |
| RSI divergence | In favour (reversal entry) | +8 |
| Counter-EMA200 | BUY below / SELL above 1h EMA200 | −8 |
| OI_NEUTRAL | Always | +6 |
| EXTREME_SHORT (BUY signal) | Contrarian | +8 |
| EXTREME_LONG (BUY signal) | Contrarian | −8 |
| Breakout strength HIGH_MOMENTUM | — | +12 |
| Breakout strength CONFIRMED | — | +8 |
| Breakout strength EARLY | — | +5 |

**Structure-aware stops:** `_find_structure_stop()` — anchors to swing low/high of 11 confirmed candles + 0.15×ATR buffer. Accepted when sl_dist is 0.4–2.5×ATR; otherwise falls back to flat 1×ATR.

**AI/heuristic threshold:** `AI_MIN_SETUP_SCORE = 78`. Score ≥78 → Claude Haiku. Score <78 → heuristic (no API call). ~50% credit saving. Currently: ANTHROPIC_API_KEY unset → 100% heuristic. WR=33.52% achieved without AI.

---

## SECTION 5 — Mode Configuration

| Mode | min_mcap | min_vol | min_confidence | max_coins | Status |
|------|----------|---------|----------------|-----------|--------|
| spot | $200M | $20M | 85 | 80 | ACTIVE |
| futures | $1B | $200M | 85 | 50 | ACTIVE |
| trending | $50M | $10M | 85 | 80 | ACTIVE |
| high_confidence | $2B | $500M | 87 | 30 | **PAUSED** (flag OFF) |

Spot min_confidence raised 80→85 (ALPHA.TRUTH.1): 80–85 band had −0.09R expectancy.

---

## SECTION 6 — NEVER-DO List

These actions are **permanently off the table** based on audited 30D outcome data.

| ID | Rule | Data Basis |
|----|------|-----------|
| F1 | NEVER block OI_NEUTRAL signals | WR=76.3%, Exp=+1.776R, N=38 — blocking them destroys alpha |
| F2 | NEVER lower probability gate below WR≥35% | Below breakeven (32.3% at 2.1:1 RR) |
| F3 | NEVER re-enable high_confidence without ≥30 new outcomes at WR≥40% | 0/9 wins last 7D, 26.8% WR 30D |
| F4 | NEVER increase spot min_confidence above 87 | Volume collapses; TRENDING at 85 already restricts significantly |
| F5 | NEVER gate on CMC rank change | No edge; CMC rank is visibility not quality |
| F6 | NEVER use CMC 7d price change as a signal gate | Too noisy; already a DEAD metric in intelligence |
| F7 | NEVER implement BULL_TREND gate without measuring it first | n=97 as of June 23; need n≥100 post-SIDEWAYS-gate cleanup |
| F8 | NEVER block HIGH_MOMENTUM_BREAKOUT signals | WR=81.8% — highest-alpha cohort in system; exempt from all regime gates |
| F9 | NEVER reduce BEAR_TREND threshold from current | BEAR_TREND WR=51.4% — platform's entire edge lives here |
| F10 | NEVER add multiple gates simultaneously | Can't attribute WR changes to individual changes |

---

## SECTION 7 — Sentinel Cohorts (monitoring targets)

| Cohort | n/30D | WR | Exp | Alert Threshold |
|--------|-------|----|-----|----------------|
| SIDEWAYS\|SELL\|CONFIRMED_BREAKOUT | 61 | 45.9% | +0.418R | WR < 40% on n≥10 resolved → revert SIDEWAYS.EXEMPTION.1 |
| BEAR_TREND\|SELL\|HIGH_MOMENTUM_BREAKOUT | 33 | 81.8% | +1.621R | WR < 60% on n≥10 → investigate immediately |
| OI_NEUTRAL (all modes) | ~38 | ~76.3% | +1.776R | WR < 50% on n≥10; currently fail-open (no attribution cell n≥30) |

**OI_NEUTRAL special rule:** NEVER block. Always fail-open on probability gate. Monitor via `/api/analytics/edge/report` futures breakdown as proxy.

---

## SECTION 8 — Gate Rejection Keys (from scan_metrics.py)

All 23 canonical keys in `GATE_REJECTION_KEYS`:
`BTC_DOWN_BUY, TOXIC_DENYLIST, SIGNAL_COOLDOWN, CONFIDENCE_REJECTION, CMC_REJECTION, REGIME_REJECTION, CONTRA_REGIME_REJECTION, SIDEWAYS_REJECTION, KLINE_EMPTY, KLINE_PARTIAL, MTF_REJECTION, VOLATILITY_REJECTION, TREND_STRENGTH_REJECTION, SETUP_REJECTION, RR_REJECTION, RISK_REJECTION, ms_sideways, ms_overextension, ms_candle_rejection, ms_trend_exhaustion, ms_fake_volume, ms_sr_rejection, ms_weak_breakout`

**7-day gate volume reference (from VOLUME_QUALITY_BALANCE_1, 969 scans, 52,127 coin-scans):**
- MTF_REJECTION: 16,861 (32.3%) — primary quality gate
- market_structure combined: 6,384 (12.2%)
- KLINE_EMPTY: 5,281 (10.1%) — infrastructure, not quality
- CONFIDENCE_REJECTION: 2,647 (5.1%)
- SIGNAL_COOLDOWN: 1,270 (2.4%)
- Pipeline survival rate: 349/52,127 = 0.67%
- Delivery survival rate: 27/260 eligible = 10.8% (84% probability gate in SIDEWAYS-heavy D7)

---

## SECTION 9 — Next Gate: BULL_TREND (deferred to post June 30)

Data basis: n=97, WR=21.65%, Exp=−0.330R, PF=0.579
Decision criteria: Implement when n≥100 AND WR<25% confirmed on rolling 30D after SIDEWAYS gate stabilizes.
Risk: ALL BULL_TREND signals currently pass the probability gate (WR<40% → suppressed at delivery). So BULL_TREND is already not being delivered. The structural gate would simply block them from being generated.

**Do not implement before July 1 measurement.** Let probability gate do the suppression work until then.

---

## SECTION 10 — Intelligence Sources and Trust

| Source | What It Powers | Trust Level |
|--------|---------------|-------------|
| Binance klines (1h/4h/1d) | market_regime, breakout_strength, oi_interpretation, RSI, MACD, EMA, ATR | HIGHEST ALPHA |
| CMC listings | market cap, volume, rank, sector | CRITICAL gating |
| Binance funding + OI | funding_trend, oi_interpretation, positioning | HIGH ALPHA |
| CMC trending | TrendScore, trending universe | USEFUL |
| CMC sectors | sector_status (STRONGEST/ACCELERATING/etc.) | USEFUL |
| CoinGecko | Fallback only (CMC unavailable) | FALLBACK |

**CMC direct Python fallback** (`_fallback_cmc_direct()` in `intelligence_cache.py`): when Redis intel cache cold, Python calls CMC listings API directly BEFORE CoinGecko. Prevents 0-coin scans.

---

## SECTION 11 — POSTFIX.1 Targets (active as of June 23)

**SIDEWAYS.EXEMPTION.1 POSTFIX.1 (due June 30):**
1. SIDEWAYS_REJECTION count: < 12/day (EARLY+NULL still blocked, CONFIRMED passes)
2. CONFIRMED_BREAKOUT signals in delivery feed: ≥1 if any SIDEWAYS period occurred
3. SIDEWAYS|SELL|CONFIRMED WR on n≥10: ≥40%
4. No EARLY_BREAKOUT or NULL signals appearing in SIDEWAYS delivery

**Revert condition:** If SIDEWAYS|SELL|CONFIRMED WR < 40% on n≥10 → revert in `signal_pipeline.py` Step 10.5.5:
Change `not in ("HIGH_MOMENTUM_BREAKOUT", "CONFIRMED_BREAKOUT")` back to `!= "HIGH_MOMENTUM_BREAKOUT"`.
