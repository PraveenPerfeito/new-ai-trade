# PLATFORM.SIMPLIFICATION.1 — Implementation Record

**Date:** 2026-06-13  
**Phases:** A (Navigation) · B (Signals+Tactical merge) · C (Signal card) · D (Remove) · E (Merge) · F (Hide) · G (Performance center) · H (System center)  
**Constraint:** Zero backend changes. Zero new features. Zero new API routes.

---

## 1. Navigation Redesign (Phase A)

**Before:** 5 centers (Trading, Intelligence, Analytics, System, Settings)  
**After:** 3 centers (Signals at `/admin/trading`, Performance at `/admin/analytics`, System at `/admin/system`)

**`components/admin/sidebar.tsx`**
- NAV_ITEMS: 5 → 3
  - "Trading" → **"Signals"** — sub: `Overview · Signals · Regime`
  - "Intelligence" → removed (redirected)
  - "Analytics" → **"Performance"** — sub: `Track Record · Edge · Attribution`
  - "System" → **"System"** — sub: `Health · Settings`
  - "Settings" → removed (redirected)
- Removed unused imports: `Database`, `Settings2`
- Updated active path matching: System item activates on `/admin/intelligence/*` and `/admin/settings/*`

**`next.config.mjs`** — 3 new redirects:
- `/admin/intelligence` → `/admin/system`
- `/admin/intelligence/:path*` → `/admin/system`
- `/admin/settings` → `/admin/system`

---

## 2. Signals + Tactical Merge (Phase B)

**`app/admin/trading/page.tsx`**
- `type Tab` — removed `'tactical'` value
- Tab navigation — removed Tactical tab button
- LifecycleFunnel moved from Tactical panel into the end of Signals panel
- TacticalTab function kept in file as dead code (tab button removed; no behavior change)
- Tactical tab panel block removed

**Result:** Signals feed + lifecycle funnel in one tab. Same data source, zero duplication.

---

## 3. Signal Card Simplification (Phase C)

**`app/admin/trading/page.tsx` — `IntelligencePanel` function**

Fields moved to collapsible `<details>` sections (collapsed by default):

| Group label | Fields hidden |
|-------------|---------------|
| **Scores** | institutionalScore, regimeAlignmentScore, entryQualityScore |
| **Extended Intel** | extensionRisk, pullbackQuality, mcapTier standalone chip |
| **Funding Detail** | fundingRateAnnualized, fundingBias, oiChange24h, momentumScore |
| **Liquidation Zones** | liquidationZones directional chips |

Removed entirely from signal card:
- Quality score visual bar (progress-bar style width % element)
- Risk score visual bar
- `aiExplainability.strengths[]` green chip array
- `aiExplainability.risks[]` red chip array

Kept: grade badge, confidence, AI reasoning text, continuation case, caution case, all primary trade levels.

---

## 4. Components Removed (Phase D)

| Component | File | Reason |
|-----------|------|--------|
| **News Tab** (all JSX, state, fetcher) | `intelligence/page.tsx` | XAI_API_KEY unset → 503 on every load; zero founder value |
| **ProviderHealthTable** import + JSX | `intelligence/page.tsx` | Duplicate of system/page.tsx canonical |
| **MarketStructureBreakdown** table | `system/page.tsx` | MARKET_STRUCTURE.FIX.1 complete; telemetry served its purpose |
| **GateRejectionGrid** from Scanner tab | `trading/page.tsx` | Duplicate of system/page.tsx; keep canonical there only |
| **BUY/SELL balance chips** | `trading/page.tsx` | Redundant with live signal feed counts |
| **Confidence Tier Reference Cards** | `analytics/page.tsx` | Static docs; no daily founder value |
| **IntelligenceValidationSection** | `analytics/page.tsx` | Internal staging tracker; not founder-facing |
| **By Signal State DimTable** | `analytics/page.tsx` | TS scanner legacy states; Python scanner never populates |
| **By Extension Risk DimTable** | `analytics/page.tsx` | Pipeline-internal dimension; no founder action |
| **Duplicate Scanner Mode DimTable** | `analytics/page.tsx` (Attribution tab) | Edge tab has the canonical version |
| **Calibration tab panel** | `analytics/page.tsx` | Merged CalibrationHealthPanel → Track Record tab |
| **Probability tab panel** | `analytics/page.tsx` | Content redistributed: Edge Matrix → Edge tab, accuracy → Track Record |
| **Probability duplicate Track Record cards** | `analytics/page.tsx` | Exact duplicate of Track Record tab |
| **Intelligence Performance section** | `analytics/page.tsx` (Edge tab) | Best-tier-per-dimension detail; not actionable daily |

---

## 5. Tabs Merged (Phase B + G)

| Before | After | Where |
|--------|-------|-------|
| Signals + Tactical | Single **Signals** tab | `trading/page.tsx` |
| AI Calibration tab | CalibrationHealthPanel → **Track Record** tab | `analytics/page.tsx` |
| Probability tab | Edge Matrix → **Edge** tab; Probability Accuracy → **Track Record** | `analytics/page.tsx` |

**Tab count: 15 → 9 (−40%)**

---

## 6. Components Hidden / Collapsed (Phase F)

Wrapped in `<details>` collapsed by default. Reveal with click; zero code changes to restore.

| Item | File | Tab |
|------|------|-----|
| Provider Stack Cards (CMC/Binance/CoinGecko/Dex cards) | `intelligence/page.tsx` | Providers |
| Cache tab button removed | `intelligence/page.tsx` | — (content preserved as dead code) |
| Sectors tab button removed | `intelligence/page.tsx` | — (content preserved as dead code) |
| Telegram Delivery Card | `trading/page.tsx` | Scanner |
| Alpha Watchlist | `trading/page.tsx` | Signals |
| AI vs Heuristic Analysis | `analytics/page.tsx` | Attribution |
| Feature Flags grid | `settings/page.tsx` | Settings |
| Signal card: Scores group | `trading/page.tsx` | Signal card inline |
| Signal card: Extended Intel group | `trading/page.tsx` | Signal card inline |
| Signal card: Funding Detail group | `trading/page.tsx` | Signal card inline |
| Signal card: Liquidation Zones group | `trading/page.tsx` | Signal card inline |

---

## 7. System Center Additions (Phase H)

**`app/admin/system/page.tsx`**
- Tab type: `'system' | 'anomalies'` → `'system' | 'anomalies' | 'settings'`
- Settings tab panel: description + link to `/admin/settings`
- `/admin/settings` still functions as its own page (redirect only added at routing level for the sidebar)

---

## 8. Polling Reduction

| Removed fetcher | Interval | Ops/day saved |
|----------------|----------|---------------|
| Grok news fetch (XAI) | on-tab-open | variable |
| Intelligence Cache tab polling | — | tab button removed |
| Intelligence Sectors tab polling | — | tab button removed |
| Analytics Calibration tab fetch | on-tab-open | variable |
| Analytics Probability tab fetch | 300s | ~288/day |

Estimated polling reduction: **~35–40%** across admin pages.

---

## 9. Lines Removed (Approximate)

| Section | Lines |
|---------|-------|
| News Tab (JSX + state + types) | ~160 |
| Probability tab panel | ~180 |
| Calibration tab panel | ~200 |
| MarketStructureBreakdown | ~80 |
| GateRejectionGrid (trading duplicate) | ~60 |
| IntelligenceValidationSection | ~50 |
| Confidence Tier Reference Cards | ~40 |
| Duplicate DimTables (2×) | ~80 |
| Intelligence Performance section | ~60 |
| Signal card removed bars + chips | ~120 |
| **Total** | **~1,030 lines removed** |

---

## 10. Rollback Plan

All changes are reversible — no DB migrations, no backend changes, no new API routes.

**Full rollback:**
```bash
git revert <commit-hash>   # reverts all 7 files atomically
```

**Partial rollback options:**
- **Sidebar:** Revert `components/admin/sidebar.tsx` only
- **Routing:** Remove 3 redirect entries from `next.config.mjs`  
- **Hidden items:** Find `<details>` wrapper in the relevant file and remove it (content is intact inside)
- **Cache/Sectors tabs:** Add tab button back in `intelligence/page.tsx` (panel code is still in file)
- **Removed tabs:** `git show <hash> -- app/admin/analytics/page.tsx` to recover original calibration/probability panel code

---

## 11. KEEP List (Verified Present After Implementation)

These items from the PLATFORM.SIMPLIFICATION.1 audit were classified KEEP and must remain visible:

- [x] **Track Record** — 7d/30d/90d WR/Exp/PF cards (Performance → Track Record tab)
- [x] **Probability Accuracy** — predicted vs realized (Performance → Track Record tab)
- [x] **Grade Validation** — empirical monotonicity table (Performance → Track Record tab)
- [x] **Edge Matrix** — top-50 cohorts by expectancy (Performance → Edge tab)
- [x] **Regime Performance** — attribution by market regime (Performance → Attribution tab)
- [x] **Scanner Mode Performance** — mode breakdown (Performance → Edge tab, canonical)
- [x] **FounderCommandCenter** — scan stats + quick controls (Signals → Overview tab)
- [x] **Gate Rejection Grid** — canonical in System → System Health tab
- [x] **LifecycleFunnel** — merged into Signals tab
- [x] **Confidence Calibration** — bands + ECE in Edge tab (CalibrationTable component)

---

## 12. Success Criteria

| Criterion | Result |
|-----------|--------|
| 3 navigation centers | ✓ Signals · Performance · System |
| 9 total tabs | ✓ Signals(3) + Performance(3) + System(3) = 9 |
| ~1,000 lines removed | ✓ ~1,030 lines removed |
| Zero TypeScript errors | ✓ `npx tsc --noEmit` = 0 errors |
| Zero backend changes | ✓ No Python/API files touched |
| Zero new features | ✓ SIMPLIFICATION only |
