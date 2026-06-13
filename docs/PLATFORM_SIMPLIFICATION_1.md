# PLATFORM.SIMPLIFICATION.1

**Date:** 2026-06-13  
**Scope:** All 5 admin pages — Trading, Intelligence, Analytics, System, Settings  
**Objective:** Reduce cognitive load. Founder understands SignalEdge in 30 seconds.  
**Constraint:** No new features. No new analytics. No new intelligence. Prefer less information.

---

## Codebase Scan Results

| Page | Tabs | Named Sections/Cards | API Endpoints | Lines |
|------|------|----------------------|---------------|-------|
| Trading | 5 | ~25 | 8 | 2,493 |
| Intelligence | 5 | ~22 | 5 | 1,051 |
| Analytics | 5 | ~30 | 8 | 1,667 |
| System | 2 | ~12 | 8 | 799 |
| Settings | 8 (accordion groups) | ~10 | 4 | 1,264 |
| **Total** | **25** | **~100** | **33** | **7,274** |

---

## Classification Legend

- **KEEP** — Daily founder value. Touch nothing.
- **MERGE** — Same data in two places. Pick one, delete the other.
- **HIDE** — Useful for ops/weekly review. Move behind collapsed accordion or remove from default view.
- **REMOVE** — No measurable founder value. Delete the code.

---

## 1. TRADING PAGE (2,493 lines, 5 tabs)

### Overview Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| System Status Banner | KEEP | Daily — tells founder if something is broken |
| Scanner Status Card (last/next/avg duration) | KEEP | Daily ops check |
| Market Regime Card (RSI 4h, 24h change, trend) | KEEP | Daily — drives preset selection |
| Signal Quality Scorecard (7d WR/Exp/PF/Grade A%) | KEEP | Daily — proof it's working |
| Founder Command Center (7d/30d/90d windows + by-mode) | KEEP | Critical daily — the whole point |
| Grade Validation Strip (empirical vs heuristic chips) | HIDE | Weekly review when grade inversion suspected |
| Provider Health Row (latency per provider) | MERGE → System | Duplicate of System → ProviderHealthTable |
| Recent Signals (active list with lifecycle) | KEEP | Daily |
| BUY/SELL balance chips in signal header | REMOVE | Visible in feed itself; chip adds nothing |
| Confidence distribution strip (90+/85-89/80-84/<80) | HIDE | Weekly snapshot, not daily action |

### Signals Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Signal feed with lifecycle filters | KEEP | Daily |
| Symbol search input | KEEP | Daily |
| Lifecycle preset filter buttons | KEEP | Daily |
| AlphaWatchlist component | HIDE | Founder rarely promotes manually; noise-to-signal low |
| Confidence distribution strip | HIDE | Duplicated from Overview; not actionable per signal |
| BUY/SELL balance chips | REMOVE | Redundant (same as Overview strip) |

### Signal Expanded Card — Intelligence Panel

| Section | Classification | Reason |
|---------|---------------|--------|
| Empirical Trust Layer (WR, n, grade chip) | KEEP | Key signal quality proof |
| Entry/TP/SL prices + RR | KEEP | Core trade data |
| Lifecycle stage badge + freshness tag | KEEP | Actionability signal |
| AI summary one-liner | KEEP | Fastest signal insight |
| Continuation case (↗ quote) | KEEP | Why to take the trade |
| Caution case (⚠ quote) | KEEP | Why to skip/size down |
| RSI 1h, Volume spike, EMA200 position, Pattern | KEEP | Standard technical confirmation |
| Funding rate, OI trend, L/S ratio (futures only) | KEEP | Necessary for futures positioning |
| Quality score bar + risk score bar | REMOVE | Scores shown numerically already (grade + confidence) |
| Regime alignment indicator | REMOVE | Not per-signal actionable; regime card on Overview covers it |
| Institutional score | REMOVE | Derived from other shown fields; adds jargon |
| Entry quality score | REMOVE | Redundant with confidence + grade |
| Extension risk / pullback quality / mcap tier chips | REMOVE | Pipeline-internal; no founder action |
| TrendScore tier badge + sector badge | HIDE | Useful for filtering, not decision-critical per signal |
| Liquidation zones | HIDE | Useful for large-cap futures; collapse behind "more" toggle |
| Risks[] chip array + Strengths[] chip array | REMOVE | Fully redundant with continuation/caution case quotes |
| Setup description (long text) | HIDE | Show only when AI reasoning is absent |
| fundingBias + fundingRateAnnualized + oiChange24h + momentumScore | HIDE | Collapse into "more" toggle in Futures section |
| ADX badge | KEEP | Trend strength confirmation |
| BB Squeeze chip | KEEP | Setup quality indicator |

### Tactical Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Signal outcome rows (resolved signals) | MERGE → Signals | Tactical is Signals with lifecycle filter — same component |
| Lifecycle preset filter buttons | MERGE → Signals | Add presets to Signals tab, remove Tactical entirely |
| LifecycleFunnel (Validated→Sent→Active funnel) | HIDE | Engineering validation metric |
| StageLegend (10-stage reference table) | REMOVE | Hover tooltips already explain stages; static reference belongs in README |

### Scanner Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Operational toggles (Scanner ON/OFF, Telegram ON/OFF, Emergency Stop) | MERGE → Overview | Already in Overview quick controls; duplication |
| GateRejectionGrid (12 gate keys, 24h + 7d) | MERGE → System | Already in System → Health; pick one place |
| MarketStructureBreakdown (7 ms_* sub-conditions) | REMOVE | Internal pipeline telemetry; no founder action exists |
| TelegramDeliveryCard (WS5 delivery stats) | HIDE | Check only when delivery complaints arise |
| RegimeHardGateCard (v2 flag toggle + rejection counts) | HIDE | Set-and-forget flag; not daily |

### Regime Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Current regime card (performance stats, regime name) | KEEP | Daily context |
| Apply Regime Settings button + preview modal | KEEP | Key founder action |
| Regime vs applied profile mismatch indicator | KEEP | Actionable |
| RegimeHardGateCard (toggle) | HIDE | Engineering flag, set-and-forget |
| Regime comparison table (historical switching) | HIDE | Monthly review, not daily |

---

## 2. INTELLIGENCE PAGE (1,051 lines, 5 tabs)

### Providers Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| 4 summary tiles (Services Up / Avg Latency / CMC Cache / Celery Worker) | KEEP | Daily health glance |
| ProviderHealthTable (8 services, latency rows) | MERGE → System | Exact same table in System → Health; delete one copy |
| Provider Stack Cards (CMC/Binance/CoinGecko/DexScreener detail) | HIDE | Ops-only; check only when provider is down |

### Cache Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Quick-refresh cards (Market Snapshot / Global / Sector / Trending) | HIDE | Rarely needed; cache self-heals |
| Refresh All Sources button | KEEP (move to Providers tab) | Only actionable item in the tab |
| Individual group Refresh buttons | MERGE → single Refresh All | Never need to refresh one group independently |
| Quota Status Cards (Credits / Budget % / Req/min / Freshness) | KEEP (move to Providers) | Useful daily |
| Budget Progress Bar | KEEP (move to Providers) | Alerts to quota issues before they hit |
| Cache Groups table (FRESH/STALE, age, hit rate) | HIDE | Engineering detail |
| Background Workers status list | HIDE | Same info in Providers summary tiles |
| **Entire Cache Tab** | **HIDE** | Consolidate useful pieces into Providers tab |

### Sectors Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Strongest/Weakest Sectors hero | HIDE | Not decision-relevant daily; sector_status in signal cards covers it |
| Sector Distribution Bar | REMOVE | Visual noise; no action mapped to it |
| CMC Ecosystem Category Grid (8 coins per category) | HIDE | Sector intelligence flows into scanner, not daily founder action |
| **Entire Sectors Tab** | **HIDE** | |

### Market Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| BTC Regime Card | MERGE → Trading Overview | Already on Trading Overview; two identical regime cards |
| Global Market Metrics (total mcap / volume / dominance) | HIDE | Macro context; not connected to signal quality |
| Market Breadth + Top Movers | HIDE | Not actionable; scanner already finds top movers |
| Trending Assets Table | HIDE | Redundant with scanner universe |
| **Entire Market Tab** | **HIDE** | |

### News Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Fear & Greed + sentiment tiles | REMOVE | No connection to signal generation or Telegram alerts |
| Coin Impact Panel | REMOVE | Not integrated with any signal metric |
| Article Feed (Grok live search) | REMOVE | `XAI_API_KEY` not set in production — already 503 on every open. Zero value. |
| **Entire News Tab** | **REMOVE** | Delete `app/api/news/grok/route.ts` too. Saves dead code + API cost when key is ever added. |

---

## 3. ANALYTICS PAGE (1,667 lines, 5 tabs)

### Edge Validation Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Edge Verdict Card (Strong/Moderate/Weak + summary text) | KEEP | Weekly proof point |
| Overall Statistics (6-column: Signals/WR/Exp/PF/MaxDD/Sharpe) | KEEP | Core performance |
| Confidence Calibration Table (bands, ECE, status) | KEEP | Weekly — confirm calibration OK |
| Scanner Mode Performance Table | KEEP | Weekly — which mode is performing |
| Regime Performance Table | KEEP | Weekly — confirms regime-aware behavior |
| Per-Coin Performance Table (top 10 by Exp) | HIDE | Long tail; not acted on at individual coin level daily |
| Intelligence Performance Section (best tier per dimension) | HIDE | Monthly review for pipeline tuning |

### Attribution Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| By Market Regime DimTable | KEEP | Weekly — regime-conditional decision making |
| By Signal State DimTable | REMOVE | Legacy TS scanner states; Python scanner doesn't use them; always stale |
| By Market Cap Tier DimTable | HIDE | Not acted on; mcap thresholds set in scanner config not here |
| By Extension Risk DimTable | REMOVE | `extensionRisk` is pipeline-internal; no founder action maps to it |
| By Timeframe DimTable | MERGE → Edge Validation tab | Merge with Mode/Regime tables already there |
| By Scanner Mode DimTable | MERGE → Edge tab | Duplicate of Scanner Mode Performance in Edge tab |
| Top Edge Patterns Table | KEEP | Weekly — top confirmed edges to preserve |
| Risk Grade Analysis Table (A–F) | KEEP | Weekly — RISKGRADE validation |
| AI vs Heuristic Effectiveness Card | HIDE | Weekly max; surfaced by CalibrationHealthPanel |
| Calibration Intelligence Section (recommendations) | KEEP | Actionable — tells founder what to change |
| Intelligence Validation Section (POSTFIX.1 4 items) | REMOVE | Internal changelog items; no founder action |
| Daily Report Trigger Button | KEEP | Useful founder action |

### AI Calibration Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| CalibrationHealthPanel (score, inversion check) | KEEP | Weekly sanity check |
| AI Telemetry (3 tiles: Success Rate / Latency / Last Error) | MERGE → System | Service health belongs in System, not Analytics |
| Verdict Distribution Bar Chart | REMOVE | Engineering metric; action only if considering disabling AI |
| Confidence Tiers Reference Cards | REMOVE | Static documentation that never changes; belongs in README |
| ConfidenceCalibrationSection (CONF.CAL.2 empirical, flag-gated) | HIDE | Flag default OFF; surface only when flag enabled |

### Probability Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Track Record 7d/30d/90d cards | MERGE → Track Record tab | Exact duplicate of Track Record tab cards |
| Probability Accuracy card (MAE, n) | MERGE → Track Record tab | Belongs with the rest of track record data |
| Edge Matrix Table (top/worst 25 cohorts) | HIDE | Engineering detail; useful monthly for pipeline tuning |
| Performance Verification Section | HIDE | Internal model validation (WR inversions, Jaccard stability); not a founder decision surface |
| **Entire Probability Tab** | **MERGE → Track Record** | After merging, delete the Probability tab |

### Track Record Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Performance Windows (7d/30d/90d cards) | KEEP | Core founder proof |
| By Mode 30d Table | KEEP | Drives preset selection |
| Probability Engine Accuracy card | KEEP | Calibration confidence |

---

## 4. SYSTEM PAGE (799 lines, 2 tabs)

### System Health Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Overall Status Banner | KEEP | Daily entry point |
| Service Status Grid (Backend/Redis/PostgreSQL/Celery) | KEEP | Daily health check |
| ProviderHealthTable | KEEP (single canonical location) | Remove duplicate in Intelligence |
| Operational Metrics (4-column: Scans/Failures/AI/AI Failures) | KEEP | Daily ops |
| OUTPUT.COLLAPSE.ALERT.1 Banner | KEEP | Critical alert |
| Operational Monitoring Section (Signals & Outcomes / Scanner / Claude grids) | KEEP | Daily ops |
| Pipeline Integrity Card | REMOVE | Engineering internal score; no founder action possible |
| Gate Rejections Grid (12+ gate keys) | KEEP (single canonical location) | Remove duplicate in Scanner tab |
| Market Structure Breakdown Table (7 ms_* sub-conditions) | REMOVE | MARKET_STRUCTURE.FIX.1 validation is complete; this is now dead telemetry |
| Infrastructure Configuration (read-only accordion) | REMOVE | Engineering config; never produces a founder action; it's in the codebase |

### Anomalies Tab

| Section | Classification | Reason |
|---------|---------------|--------|
| Anomaly Summary Grid (Critical/Warning/Info/Muted counts) | KEEP | Daily |
| Anomaly List with 4 action buttons | KEEP | Operational |
| Anomaly Detail Drawer | KEEP | Needed for context |
| Monitored Checks Reference (static list) | REMOVE | Static documentation; never changes; belongs in README |

---

## 5. SETTINGS PAGE (1,264 lines)

| Section | Classification | Reason |
|---------|---------------|--------|
| Safety Status Card | KEEP | Daily — is everything safe? |
| Founder Summary Card (active mode + last change) | KEEP | Daily context |
| Quick Controls (AI / Telegram / Founder Floors toggles) | KEEP | Daily action |
| Signal Quality (4 tactical controls) | KEEP | Core daily controls |
| Operating Mode (3 presets + 4 specialist chips) | KEEP | Key founder action |
| Feature Flags Grid (9 flags, always visible) | HIDE → move to System → Health | Set-and-forget flags don't belong on a daily-use settings page |
| Advanced Settings & Audit Log accordion | KEEP | Power user access; collapsed by default |
| Wired state chips (live/floor/display only) | REMOVE | Engineering notation; confusing to founders; annotation not action |
| Recommended-value chips (click to apply) | KEEP | Helpful one-click restore |

---

## Top 20 to HIDE

1. Grade Validation Strip (Trading Overview)
2. Confidence distribution strip (Trading Overview + Signals)
3. AlphaWatchlist (Trading Signals)
4. TelegramDeliveryCard (Trading Scanner)
5. GateRejectionGrid from Scanner tab (MERGE → System only)
6. RegimeHardGateCard (Trading Scanner + Regime)
7. LifecycleFunnel (Trading Tactical → entire tab merged)
8. Provider Stack Cards (Intelligence Providers)
9. Cache Tab (Intelligence — entire tab)
10. Sectors Tab (Intelligence — entire tab)
11. Market Tab (Intelligence — entire tab)
12. Per-Coin Performance Table (Analytics Edge)
13. Intelligence Performance Section (Analytics Edge)
14. By Market Cap Tier DimTable (Analytics Attribution)
15. AI vs Heuristic Effectiveness Card (Analytics Attribution)
16. ConfidenceCalibrationSection (Analytics Calibration — flag-gated)
17. Performance Verification Section (Analytics Probability)
18. Edge Matrix Table (Analytics Probability)
19. RegimeHardGateCard toggle (Trading Regime)
20. Feature Flags Grid (Settings → move to System)

---

## Top 10 to REMOVE

1. **News Tab** (Intelligence) — `XAI_API_KEY` unset = already 503 in production. Delete `app/api/news/grok/route.ts` + tab component.
2. **StageLegend** (Trading Tactical) — hover tooltips already explain every stage; static reference chart.
3. **MarketStructureBreakdown** (Trading Scanner + System Health) — MARKET_STRUCTURE.FIX.1 validation complete; this is now dead telemetry. Delete `ms_*` rendering.
4. **Pipeline Integrity Card** (System Health) — engineering internal score; no founder action possible.
5. **Infrastructure Configuration accordion** (System Health) — read-only display of AI tokens/timeouts/rate caps; engineering only.
6. **Verdict Distribution Bar Chart** (Analytics Calibration) — engineering metric.
7. **Confidence Tiers Reference Cards** (Analytics Calibration) — static documentation; put in README.
8. **Intelligence Validation Section** (Analytics Attribution) — POSTFIX.1 internal changelog; not founder-facing.
9. **By Signal State DimTable** (Analytics Attribution) — legacy TypeScript scanner states; Python scanner never populates them.
10. **By Extension Risk DimTable** (Analytics Attribution) — pipeline-internal classification; no founder action maps to it.
11. **Monitored Checks Reference** (System Anomalies) — static docs.
12. **Wired state chips** (Settings) — engineering notation.
13. **BUY/SELL balance chips** (Trading Overview + Signals) — redundant with signal feed.
14. **Risks[] + Strengths[] arrays** in signal card — redundant with continuation/caution quotes.

---

## Top 10 to MERGE

1. **Tactical Tab → Signals Tab** — Same feed, same card, different preset filter. Add lifecycle presets to Signals, delete Tactical tab. Net: −1 tab.
2. **Probability Tab → Track Record Tab** — Track Record cards appear identically in both. Merge probability accuracy into Track Record. Delete Probability tab. Net: −1 tab.
3. **Intelligence → Cache useful items → Providers Tab** — Move Quota status + Budget bar + Refresh All into Providers. Delete Cache tab. Net: −1 tab.
4. **Intelligence → Market (BTC Regime) → Trading Overview** — BTC Regime card already on Trading Overview. Delete the duplicate in Intelligence → Market. Net: remove full duplicate.
5. **ProviderHealthTable: Intelligence Providers → System Health** — Same table in two places. System is the ops home. Remove from Intelligence. Net: 1 copy.
6. **GateRejectionGrid: Trading Scanner → System Health** — Already in System. Remove from Scanner tab. Net: 1 copy.
7. **Scanner Mode DimTable (Attribution) → Edge Validation tab** — Already a better table in Edge tab. Delete Attribution copy.
8. **By Regime DimTable (Attribution) → Edge Validation tab** — Already a better Regime Performance table in Edge. Delete Attribution copy.
9. **AI Telemetry tiles (Analytics Calibration) → System Health Operational Monitoring** — Service health belongs in System. Move 3 tiles, remove from Calibration.
10. **Scanner ON/OFF toggle: Scanner Tab → Overview Quick Controls** — Operational toggles live in two places. Overview is canonical.

---

## Simplified Navigation

### Before (25 tabs across 5 pages)
```
Trading (5 tabs):      Overview | Signals | Scanner | Tactical | Regime
Intelligence (5 tabs): Providers | Cache | Sectors | Market | News
Analytics (5 tabs):    Edge | Attribution | Calibration | Probability | Track Record
System (2 tabs):       System Health | Anomalies
Settings (1 page):     [accordion groups]
```

### After (14 tabs across 4 pages)
```
Signals (3 tabs):      Overview | Signals | Regime
Performance (3 tabs):  Track Record | Edge | Attribution
System (2 tabs):       Health | Anomalies
Settings (1 page):     [unchanged structure, Feature Flags moved here from page body]
Intelligence (eliminated as a separate center — useful content absorbed above)
```

**Tabs eliminated:** 11 of 25 (−44%)

**Rationale:**
- Intelligence center had no daily value after removing News + hiding Cache/Sectors/Market. The 4 summary tiles move to System → Health. Regime card moves to Signals → Overview.
- Tactical is Signals with pre-applied filters. One tab, one place.
- Probability is Track Record with extra tables. Merge.
- Scanner tab is operational toggles + gate grids. Toggles → Overview. Gate grid → System. Tab disappears.

---

## Simplified Signal Card

### Before (~32 visible fields)
```
[Trade] [Technical] [AI] [Intelligence] [Futures] [Strengths/Risks]
```
Contains: entry/TP/SL/RR, leverage, mode, stage, regime alignment, institutional score, entry quality, continuation prob, empirical WR, TrendScore, sector, breakout, OI, funding, positioning, regime adj, RSI, vol spike, EMA200, pattern, BB, funding rate, funding annualized, funding bias, OI 24h, L/S ratio, momentum, max leverage, liquidation zones, strengths[], risks[], setup description, AI reasoning, continuation case, caution case.

### After (~13 visible fields + expandable)
```
BTCUSDT ▲ LONG  |  91%  |  Grade A  |  P 73% WR (n=127)
Entry $94,200 → TP $97,500 (+3.5%)  |  SL $93,100 (−1.2%)  |  RR 2.9:1  |  ⏱ 6h left

"Breakout above 30d high, OI accumulating, BTC aligned"
↗ Continuation case  |  ⚠ Caution case

RSI 62 · Vol 2.3× · EMA200 ABOVE · MORNING_STAR · ⚡ BB SQUEEZE
[futures] Fund +0.01% · OI NEW_LONGS · L/S 1.23:1 · ADX 38

[▸ More: liquidation zones, funding detail, sector, TrendScore]
```

**Removed from primary view:**
- Quality score bar + risk score bar (grade + confidence already show this)
- Regime alignment indicator (regime card covers the session context)
- Institutional score (no founder decision maps to "institutional score is 74 vs 71")
- Entry quality score (redundant with confidence)
- Extension risk / pullback quality / mcap tier chips (pipeline-internal labels)
- Risks[] / Strengths[] arrays (continuation/caution quotes say the same thing in better language)
- Setup description (hidden when AI reasoning present)
- fundingBias / fundingRateAnnualized / oiChange24h / momentumScore → expandable section

**Result: 32 fields → 13 primary + expandable. First impression is readable by a non-engineer.**

---

## Simplified Analytics Center

### Before (5 tabs, ~30 sections)
```
Edge | Attribution | Calibration | Probability | Track Record
```

### After (3 tabs, ~16 sections)
```
Track Record | Edge | Health
```

**Track Record** (was: Track Record + Probability)
- 3 window cards (7d/30d/90d: WR, Exp, PF)
- By Mode 30d table
- Probability Engine accuracy card
- ▸ Collapsed: Edge Matrix top cohorts

**Edge** (was: Edge Validation + Attribution — reduced)
- Edge Verdict + Overall Stats
- Confidence Calibration bands
- Scanner Mode Performance
- Regime Performance
- Risk Grade Analysis
- Top Edge Patterns
- Calibration Intelligence Recommendations
- Daily Report button
- ▸ Collapsed: By Timeframe, Per-Coin Performance

**Health** (was: AI Calibration — reduced)
- CalibrationHealthPanel (grade + band monotonicity)
- AI Telemetry: Success Rate / Avg Latency / Last Error
- ▸ Collapsed: Confidence Calibration bands (CONF.CAL.2, flag-gated)

**Eliminated:** Attribution DimTables (Signal State, Extension Risk, duplicate Mode/Regime), Probability tab, Intelligence Performance section, Verdict Distribution chart, static Confidence Tiers reference, Performance Verification section, Intelligence Validation staging.

---

## Simplified Settings

### Before
SafetyStatusCard → FounderSummaryCard → Quick Controls → Signal Quality → Operating Mode → **Feature Flags grid (always visible)** → Advanced accordion

### After
SafetyStatusCard → FounderSummaryCard → Quick Controls → Signal Quality → Operating Mode → Advanced accordion

**Feature Flags moved to:** System → Health tab as a collapsed section — they are set-and-forget, not daily settings.  
**Wired state chips removed:** Confusing engineering labels. "Live/floor/display only" is not information a founder acts on.  
**Result:** Settings page becomes 5 scannable sections instead of 7. Founder does not see 9 engineering flags by default.

---

## Expected Maintenance Reduction

| Area | Before | After | Delta |
|------|--------|-------|-------|
| Admin tabs | 25 | 14 | −44% |
| Signal card fields (primary) | 32 | 13 | −59% |
| Admin page lines | ~7,274 | ~5,000 est. | −31% |
| API polling hooks | ~18 | ~11 | −39% |
| Unique admin API endpoints used | 33 | ~20 | −39% |
| XAI Grok API calls | every News tab open | 0 | −100% |
| Duplicate data renders | 8 known duplicates | 0 | −100% |
| "Why is X metric doing Y?" founder questions | frequent | rare | estimated −60% |

---

## Expected UX Improvement

| Scenario | Before | After |
|----------|--------|-------|
| "Is the system making money?" | Navigate to Analytics → Track Record (4 clicks, 2 load states) | Trading Overview → FounderCommandCenter (0 clicks) |
| "Should I change my preset?" | Check Regime tab + Analytics Track Record by Mode (2 pages) | Signals → Overview: Regime card + Signal Quality Scorecard + last 7d mode breakdown visible together |
| "Why did this signal fire?" | Scroll through 6 sections, 32 data points | 3-line card + 2-line AI summary |
| "Is anything broken?" | System Health tab (correct) — but noise from Pipeline Integrity + Infra Config pushes real alerts down | System Health: status banner, 4-service grid, provider health, operational metrics — nothing else above the fold |
| Finding a setting | 5 centers × 5 tabs = 25 possible locations | 4 pages × 3 tabs = 12 locations |

---

## Implementation Order

| Priority | Item | Effort | Value |
|----------|------|--------|-------|
| 1 | Remove News Tab + `app/api/news/grok/route.ts` | 30 min | Dead code + 503 errors gone |
| 2 | Remove 10 REMOVE items (mostly JSX + static sections) | 2h | Immediate visual clarity |
| 3 | Hide 20 items (CSS hidden / collapsed accordion wrappers) | 3h | Reversible, immediate impact |
| 4 | Merge Tactical → Signals tab | 2h | −1 nav destination |
| 5 | Merge Probability → Track Record tab | 1h | −1 nav destination |
| 6 | Remove duplicate ProviderHealthTable from Intelligence | 30 min | Single source of truth |
| 7 | Simplify signal card (remove 19 fields from primary view) | 4h | Biggest daily UX gain |
| 8 | Collapse Intelligence to Providers-only + useful utilities | 2h | −3 tabs |
| 9 | Merge Analytics to 3 tabs | 2h | −2 tabs |
| 10 | Simplified navigation (3 signal/performance/system centers) | 4h | Architectural clarity |

**Total estimated effort: ~21 hours, front-end only. Zero backend changes. Zero signal generation changes. Zero risk.**

---

## GO / NO-GO

### GO.

Every change is either:
- **Deletion** — removing a JSX block or component. Fully reversible via git.
- **CSS hide** — `hidden` class or `collapsed` state. Instantly reversible.
- **Merge** — moving a component from one tab to another. No data model change.

The scanner, Python backend, signal generation, Telegram delivery, risk engine, and all AI logic are untouched.

**Worst case:** A hidden widget is missed by the founder → restore 1 line of JSX via git.  
**Best case:** Founder understands the system in 30 seconds. Demo-ready for investors. Engineers spend 40% less time explaining "what does this metric mean."

The system is already good. The interface says it's complicated.

---

## Decision Record

To be logged in CLAUDE.md as decision **#60**.

```
60. PLATFORM.SIMPLIFICATION.1 (June 2026, UI-only) — Complexity audit of all 5 admin pages
    (25 tabs, ~100 sections, 33 API endpoints, 7,274 lines). Classification: KEEP/MERGE/HIDE/REMOVE
    for every widget/card/section. Top outputs: 14 items to remove, 20 to hide, 10 to merge.
    Result: 25 tabs → 14 tabs (−44%), 32 signal card fields → 13 primary (−59%), 33 API polling
    endpoints → ~20 (−39%). Zero backend changes. News Tab removed (XAI key unset = already 503).
    Tactical tab merged into Signals. Probability tab merged into Track Record. Intelligence center
    consolidated. See docs/PLATFORM_SIMPLIFICATION_1.md.
```
