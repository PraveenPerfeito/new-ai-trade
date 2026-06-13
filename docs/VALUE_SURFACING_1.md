# VALUE.SURFACING.1 — Founder Trust & Customer Conversion Sprint

**Date:** June 2026  
**Commit:** `737bbe3`  
**Rule:** Surface existing alpha. Zero changes to scanner logic, signal generation, risk engine, probability engine, confidence system, RiskGrade, regime gates, Telegram delivery, or Redis architecture.

---

## Objective

The audit in VALUE.MAXIMIZATION.1 found 23+ fields silently discarded on the way to the dashboard, plus the `/analytics/track-record` endpoint was never called from any UI. This sprint surfaces all of that for two audiences:

- **Founder**: answer "Is the system making money?" in < 5 seconds  
- **Customer**: build trust by showing probability and empirical track record next to every signal

---

## Phases Implemented

### Phase A — Founder Command Center (Trading → Overview)

**New component:** `FounderCommandCenter`  
**Data source:** `GET /analytics/track-record` (was orphaned — never called)  
**Polling:** 300 s via `useSharedPolling('trading:track-record', ...)`

Renders:
- **3 window cards** (7d / 30d / 90d) — resolved n, win rate, expectancy, profit factor  
- **By Mode 30d table** — per-scanner-mode WR + expectancy + n, color-coded  
- **Probability Engine accuracy strip** — predicted vs actual WR, MAE (only when n ≥ 10)

### Phase B — Why This Signal (IntelligencePanel expansion)

**Component:** `IntelligencePanel` (expanded)

Now shows when present:
- `continuationProbability` — forward continuation likelihood (0–100), from `signal.continuation`
- `entryQualityScore` — 0–100 composite entry quality
- `institutionalScore` — 0–100 institutional-weighted composite
- `regimeAlignmentScore` — regime adjustment applied (+/−)
- `continuation.reasons[0]` — continuation case text (italic border-quote)
- **AI reasoning: no longer truncated** (removed 240-char cutoff)

### Phase C — Empirical Trust Layer (IntelligencePanel)

**Fields:** `empiricalWr`, `empiricalN`, `empiricalGrade`

Rendered as a highlighted chip at the top of the expanded panel (bg-zinc-800/40):
```
Empirical  73% WR  n=127  Emp A+
```
Color-coded: emerald ≥ 55%, blue ≥ 45%, amber otherwise.

### Phase D — Track Record Tab (Analytics → Track Record)

**New tab:** `'track-record'` in `AnalyticsPage`  
**Component:** `TrackRecordTab`  
**Data source:** `adminApi.analytics.trackRecord()` — lazy-fetched on tab open

Layout:
- 3 window glass-cards (7d/30d/90d) — resolved, WR, expectancy, PF, W/L
- 30d by-mode table with headers  
- Probability Engine accuracy panel with data-quality warning when n < 10

### Phase E — Telegram Enhancements

**File:** `backend/core/scanner/telegram_notifier.py`

Grade line now includes:
- `Hist: 73% WR (n=127)` — appended when `empirical_wr` is available on signal
- `Cont: 72%` — appended when `continuation_probability` is available

Example output:
```
Grade: 🟢 A  |  Hist: 73% WR (n=127)  |  R:R: 1:2.4  |  Cont: 68%  |  🤖 AI Approved
```

### Phase F — Grade Validation Strip (Trading → Overview)

**New component:** `GradeValidationStrip`  
**Data source:** `GET /analytics/performance-verification` (every 300 s)

Shows empirical grades vs heuristic grades as compact chip strips:
```
Empirical   A+ 73% WR   A 63% WR   B 47% WR   C 38% WR
Heuristic   A 34% WR    B 36% WR   C 56% WR   D 14% WR
```
Only renders when n ≥ 10 per grade. Color uses the GRADE_STYLE palette for empirical, muted zinc for heuristic (intentional contrast — heuristic inversion is immediately visible).

### Phase G — Technical Context (IntelligencePanel)

**Fields surfaced:** `signal.indicators.rsi`, `signal.indicators.volumeSpike`

Shown in a dedicated row when present:
```
RSI 1h  62.4     Vol Spike  2.3×
```
RSI color: emerald ≤ 40 (oversold entry), red ≥ 70 (overbought), amber 60–70.  
Volume spike: emerald ≥ 2.5×, blue ≥ 1.5×, red < 0.8×.

### Phase H — Futures Intelligence (IntelligencePanel)

**Fields surfaced:** `futuresData.fundingRate`, `futuresData.oiTrend`, `futuresData.longShortRatio`, `maxSafeLeverage`  
**Condition:** only rendered when `scannerMode === 'futures' || 'high_confidence'`

```
Funding Rate  +0.0125%     OI Trend  RISING     L/S Ratio  1.23     Max Lev  10×
```

### Phase I — Alpha Promotion Watchlist

**New API route:** `GET /api/signals/watchlist`  
- Validated, non-alerted signals from last 48h  
- Sorted by `empirical_wr DESC`, then `confidence DESC`  
- Min confidence: 75 (catches near-miss signals below the alert threshold)

**New component:** `AlphaWatchlist` (appended below Signals feed in SignalsTab)  
- Symbol + type + grade + confidence + empirical P chip + breakout strength + age  
- 120 s refresh via `useAutoRefresh`  
- Shows "No near-miss signals in the last 48h" when empty

### Phase J — Signal Freshness (ACTIVE signals)

**New component:** `FreshnessTag`  
**Applies to:** ACTIVE lifecycle stage only  
**Logic:** `windowH - hoursElapsed` using `LIFETIME_MS` windows (1h→8h, 4h→24h, 1d→72h)

```
⏱ 6h left    (green when > 50% remaining)
⏱ 2h left    (amber when 25–50%)
⏱ 40m left   (red when < 25%)
```

Added to: Overview tab recent signal rows + SignalsTab signal rows.

---

## Files Changed

| File | Change |
|------|--------|
| `app/admin/trading/page.tsx` | +395 lines — Phases A, B, C, F, G, H, I, J |
| `app/admin/analytics/page.tsx` | +150 lines — Phase D (Track Record tab) |
| `backend/core/scanner/telegram_notifier.py` | +11 lines — Phase E |
| `app/api/signals/watchlist/route.ts` | New file — Phase I API |

---

## What Was NOT Changed

- Scanner logic (`orchestrator.py`, `signal_pipeline.py`, `market_fetcher.py`, etc.)
- Signal generation, risk engine, probability engine, confidence system
- RiskGrade system, regime gates, Telegram delivery reliability
- Redis architecture, settings system, auth middleware

---

## Validation Checklist

- [x] TypeScript: `npx tsc --noEmit` — zero errors
- [x] Build: `npm run build` — clean, watchlist route appears in build output
- [x] No new external API calls — all data from existing backend endpoints
- [x] No polling frequency increase — track-record at 300s, grade-verification at 300s
- [x] Zero scanner/backend signal-generation code touched

---

---

## VALUE.SURFACING.2 — Remaining 15 Hidden Fields

**Date:** June 2026  
**Commit:** `d637674`  
**Rule:** Same constraint as SURFACING.1 — zero scanner/signal-generation changes.

### Overview

After SURFACING.1 landed, a second pass against the `docs/VALUE_MAXIMIZATION_1.md` audit table found 15 additional fields that were computed and typed but never rendered, plus two orphaned edge sub-analyses already embedded in the `/analytics/edge/report` payload.

### Phase K — Extended Technical (Python-side fields)

**Problem:** `TechnicalIndicators` TypeScript interface only declares `rsi, macd, ema20, ema50, atr, volumeSpike, currentPrice, trend`. Three Python-side fields (`ema200`, `candle_pattern`, `bb.squeeze`) exist on the runtime object but are absent from the TS type.

**Solution:** Safe double-cast pattern — `sig.indicators as unknown as Record<string, unknown>` — reads the runtime values without modifying `types/index.ts`.

Fields surfaced:
- **EMA200 ABOVE/BELOW** — computed as `currentPrice > ema200Raw ? 'ABOVE' : 'BELOW'`; shown as emerald/red chip
- **Candle Pattern** — `candle_pattern` string (e.g. `BULLISH_ENGULFING`); shown in technical row when not `'NONE'`
- **BB SQUEEZE** — `bb.squeeze` boolean; shown as `⚡ BB SQUEEZE` amber chip when true

### Phase L — Extended Futures (4 hidden fields)

**Fields:** `futuresData.fundingRateAnnualized`, `futuresData.fundingBias`, `futuresData.oiChange24h`, `futuresData.momentumScore`

These were typed on `FuturesData` in `types/index.ts` but absent from the Phase H futures row added in SURFACING.1.

Rendered below the existing 4 fields (funding rate, OI trend, L/S ratio, max leverage):
```
Fund Bias  BEARISH      Fund Ann  -16.4%/yr      OI 24h  +12.3%      Momentum  74
```

### Phase M — AI Explainability (3 fields)

**Fields:** `signal.aiExplainability.summary`, `.continuationCase`, `.cautionCase`

All three were typed on `AIExplainability` in `types/index.ts` and set by `ai_validator.py` during Claude validation, but never rendered anywhere in the UI (the existing AI section only showed `rationale`).

Rendered as a dedicated sub-section in the expanded signal card:
- `summary` — one-line trade thesis (zinc-300, medium weight)
- `continuationCase` — the bull case (emerald-400/75, left-border quote, `↗` prefix)
- `cautionCase` — the bear case / caution (amber-400/75, left-border quote, `⚠` prefix)

### Phase N — Risks / Strengths Arrays

**Fields:** `signal.risks[]`, `signal.strengths[]`

Typed as `string[]` on `TradingSignal`, populated by the scanner pipeline, never rendered.

Rendered as compact chip rows below the AI explainability section:
- Strengths: emerald chips with `✓` prefix (up to 3)
- Risks: red chips with `⚠` prefix (up to 3)

### Phase O — MCap Tier / Extension Risk / Pullback Quality

**Fields:** `signal.mcapTier`, `signal.extensionRisk`, `signal.pullbackQuality`

Added to the intelligence `fields[]` row in IntelligencePanel:
- `mcapTier` — title-cased label (e.g. `Large`)
- `extensionRisk` — only shown when not `'LOW'`; red for `'HIGH'`, amber for `'MEDIUM'`
- `pullbackQuality` — short-labelled via existing `shortLabel()` helper

### Phase P — Orphaned Edge Sub-Analyses

**Problem:** `/analytics/edge/report` (the full EdgeReport payload) already contains `scanner_mode_analysis` and `market_regime_analysis` objects. The TypeScript `EdgeReport` interface in `lib/admin-api.ts` didn't declare them, so they were silently dropped during JSON deserialization and never shown.

**Solution:** Extended the `EdgeReport` interface to add both sub-analyses, plus a new `EdgeModeStats` interface:

```typescript
export interface EdgeModeStats {
  label: string
  total: number
  wins: number
  losses: number
  win_rate: number | null
  expectancy: number | null
  profit_factor: number | null
  insufficient_data: boolean
  signals_per_day?: number | null
}
```

**Rendered in Analytics → Edge tab:**
- **Scanner Mode Performance** table — ranked by expectancy, columns: WR, Exp, PF, per-day; insufficient-data rows grayed
- **Market Regime Performance** table — ranked by expectancy; PREFER/AVOID tags on top/bottom regimes

No new API calls — data was already in the existing payload.

---

## Files Changed (SURFACING.2)

| File | Change |
|------|--------|
| `app/admin/trading/page.tsx` | +90 lines — Phases K–N |
| `lib/admin-api.ts` | +32 lines — `EdgeModeStats` type + `EdgeReport` extension |
| `app/admin/analytics/page.tsx` | +80 lines — Phase P scanner-mode + regime tables |

---

## Complete Hidden Fields Resolution

All 23 items from the `docs/VALUE_MAXIMIZATION_1.md` Hidden Fields Audit are now resolved across the two sprints:

| Field | Sprint |
|-------|--------|
| `empiricalWr` / `empiricalN` / `empiricalGrade` | SURFACING.1 Phase C |
| `continuationProbability` | SURFACING.1 Phase B |
| `entryQualityScore` | SURFACING.1 Phase B |
| `institutionalScore` | SURFACING.1 Phase B |
| `regimeAlignmentScore` | SURFACING.1 Phase B |
| `continuation.reasons[0]` | SURFACING.1 Phase B |
| AI reasoning (untruncated) | SURFACING.1 Phase B |
| `indicators.rsi` | SURFACING.1 Phase G |
| `indicators.volumeSpike` | SURFACING.1 Phase G |
| `futuresData.fundingRate` | SURFACING.1 Phase H |
| `futuresData.oiTrend` | SURFACING.1 Phase H |
| `futuresData.longShortRatio` | SURFACING.1 Phase H |
| `maxSafeLeverage` | SURFACING.1 Phase H |
| Track Record endpoint (`/analytics/track-record`) | SURFACING.1 Phase D |
| `ema200` (Python-side) | SURFACING.2 Phase K |
| `candle_pattern` (Python-side) | SURFACING.2 Phase K |
| `bb.squeeze` (Python-side) | SURFACING.2 Phase K |
| `futuresData.fundingRateAnnualized` | SURFACING.2 Phase L |
| `futuresData.fundingBias` | SURFACING.2 Phase L |
| `futuresData.oiChange24h` | SURFACING.2 Phase L |
| `futuresData.momentumScore` | SURFACING.2 Phase L |
| `aiExplainability.summary/continuationCase/cautionCase` | SURFACING.2 Phase M |
| `risks[]` / `strengths[]` | SURFACING.2 Phase N |
| `mcapTier` / `extensionRisk` / `pullbackQuality` | SURFACING.2 Phase O |
| Scanner mode + regime edge analysis | SURFACING.2 Phase P |

---

---

## VALUE.SURFACING.3 — Final Gaps

**Date:** June 2026  
**Commit:** `cc3a63f`

### Liquidation Zones (IntelligencePanel)

`futuresData.liquidationZones[]` was typed on `FuturesData` in `types/index.ts` but never rendered in any sprint. Each `LiquidationZone` has `price`, `side` (`LONG_LIQ` / `SHORT_LIQ`), `strength` (`WEAK` / `MODERATE` / `STRONG`), `distancePct`.

Rendered as directional chips below the existing futures row:
```
↓ $94,200 · 2.1% away (strong)    ↑ $88,500 · 4.8% away
```
- `LONG_LIQ` → red chip with `↓` (price below = longs get liquidated)
- `SHORT_LIQ` → emerald chip with `↑` (price above = shorts get liquidated)
- Strength shown when not WEAK; up to 4 zones

### Per-Coin Performance Table (Analytics → Edge)

`coin_performance` was already returned inside the full `/analytics/edge/report` payload (Python `generate_edge_validation_report()` collects it via `asyncio.gather`) but `EdgeReport` in `lib/admin-api.ts` didn't declare the field, so it was silently dropped.

Added to `lib/admin-api.ts`:
- `EdgeReport.coin_performance` field
- New `CoinStats` interface (total, win_rate, expectancy, profit_factor, max_drawdown_r, sharpe_ratio, avg_duration_hours)

Table in Analytics → Edge tab: top-10 coins by expectancy, columns: Resolved / Win Rate / Expectancy / PF / Max DD. `top WR` badge for coins in `best_by_win_rate[]`; `high DD` badge for coins in `worst_by_drawdown[]`.

### Confirmed: `edge/calibration` is NOT orphaned

The audit listed it as orphaned. Investigation found it IS wired — `/analytics/edge/report` (the full report endpoint) calls `confidence_calibration()` and returns it as `EdgeReport.confidence_calibration`. The Analytics → Calibration tab already consumes this field. No gap.

---

## Files Changed (SURFACING.3)

| File | Change |
|------|--------|
| `app/admin/trading/page.tsx` | +25 lines — liquidation zones chip row |
| `lib/admin-api.ts` | +20 lines — `CoinStats` interface + `EdgeReport.coin_performance` |
| `app/admin/analytics/page.tsx` | +55 lines — Per-Coin Performance table |

---

## Pending DB Migrations (all idempotent — IF NOT EXISTS)

Run these 6 files in Supabase SQL Editor before next deploy:

| File | Adds |
|------|------|
| `probability-gate-migration.sql` | `empirical_wr`, `empirical_n` on `signals` + `signal_outcomes` |
| `probability-engine-migration.sql` | `empirical_grade` on `signals` + `signal_outcomes` |
| `telegram-delivery-migration.sql` | `telegram_delivered`, `telegram_delivery_error` on `signals` |
| `validation-source-migration.sql` | `validation_source` on `signals` |
| `ai-call-log-trace-migration.sql` | `symbol`, `setup_score` on `ai_call_log` |
| `attribution-snapshots-migration.sql` | New `attribution_snapshots` table + index |

---

## Follow-On Opportunities (Remaining)

- **Continuation scoring in DB**: `continuation.continuationProbability` is computed but not persisted; if DB column added, full historical analysis becomes possible
- **Watchlist promotions**: add one-click "promote to alert" button when founder manually reviews a watchlist signal above a confidence floor
- **Empirical grade display-primary** (`riskgrade_v2` flag): once promoted, swap Grade badge display to empirical grade — currently A+ empirical grades are hidden behind heuristic A/B/C display
- **Telegram upgrade context**: diff new signal vs cached cooldown object to show what changed when a DEDUP_UPGRADE alert fires
- **`telegram_delivered` per-signal**: surface in IntelligencePanel once `getRecentSignals()` selects the `telegram_delivered` column
