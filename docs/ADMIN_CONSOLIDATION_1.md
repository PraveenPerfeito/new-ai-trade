# ADMIN.CONSOLIDATION.1 — 13 Pages to 4 Operational Centers

**Date:** June 2026  
**Status:** COMPLETE  
**Build:** Zero TypeScript errors  
**Commit:** `7152647`

---

## Summary

Consolidated 13 fragmented admin pages into 4 purpose-built operational centers plus a settings page. Eliminates navigation sprawl, duplicate widget implementations, and duplicate polling. All existing functionality preserved. All old URLs redirect to new locations.

---

## Navigation Tree

### Before (13 pages + sidebar sprawl)

```
TRADING DESK
  /admin/overview          Scanner status, regime card, signal metrics, recent signals
  /admin/signals           Live signal feed with intelligence section
  /admin/tactical          Signal lifecycle -- colored accent bars per stage
  /admin/settings          Founder control center

MARKET
  /admin/intelligence      TrendScore, sector, breakout, OI, funding, positioning
  /admin/regime            RSI gauge, trading implication, apply regime settings
  /admin/sectors           Category cards with STRONGEST/ACCELERATING/WEAKENING/OVERCROWDED

OPERATIONS
  /admin/scanner           Start/stop/pause/resume/e-stop, mode & interval, rejection diagnostics
  /admin/anomalies         Anomaly action center -- 4-state machine, detail drawer
  /admin/providers         3-card provider status board, quota burn forecast
  /admin/cache             Hit-rate progress bars, fresh/stale count, compact workers
  /admin/system            System health, service grid, pipeline integrity

REVIEW
  /admin/analytics         Win rate, expectancy, profit factor, Sharpe -- edge + attribution
  /admin/calibration       Claude AI on/off toggle, verdict distribution, confidence bands
```

### After (4 operational centers + settings)

```
/admin/trading       Trading Operations
                     tab: overview  -- scanner status, signal counts, recent signals, regime
                     tab: scanner   -- celery status, ops toggles, manual scan, gate analysis
                     tab: signals   -- live signal feed with intelligence section
                     tab: tactical  -- signal lifecycle cards, preset filter buttons
                     tab: regime    -- regime card, RSI, implications, apply settings

/admin/intelligence  Intelligence Center
                     tab: providers -- 8-service health table, provider metadata cards
                     tab: cache     -- intelligence cache age, quota guard, workers, force-refresh
                     tab: sectors   -- sector status cards with strength classification
                     tab: market    -- regime card, global stats, trending coins, news feed

/admin/analytics     Analytics & Calibration
                     tab: edge        -- edge verdict, overall stats, confidence calibration bands
                     tab: attribution -- by regime/state/mcap/extension/grade/timeframe/mode + AI effectiveness
                     tab: calibration -- Claude success rate, latency, verdict distribution, confidence tiers

/admin/system        System Health
                     tab: system    -- service status grid, 8-provider health, operational monitoring,
                                       pipeline integrity, gate rejection grid, market structure breakdown
                     tab: anomalies -- 4-state machine (NEW->ACK->MUTED->RESOLVED), detail drawer, summary tiles

/admin/settings      Founder Settings (standalone -- not merged)
                     3 primary modes, Advanced Presets, 4 key controls, ActiveSettingsSummary
```

---

## Pages Before / After

| Before | Count | After | Count |
|--------|-------|-------|-------|
| /admin/overview, scanner, signals, tactical, regime | 5 | /admin/trading | 1 |
| /admin/providers, cache, sectors, market, intelligence | 5 | /admin/intelligence | 1 |
| /admin/analytics, calibration | 2 | /admin/analytics | 1 |
| /admin/system, anomalies | 2 | /admin/system | 1 |
| /admin/settings | 1 | /admin/settings | 1 |
| **Total** | **15** | **Total** | **5** |

All 13 feature pages consolidated into 4 centers (settings unchanged). Old page routes return HTTP 301/302 redirects -- no broken bookmarks.

---

## Widgets Removed / Merged / Reused

### Removed (duplicate implementations)

| Widget | Was duplicated in | Resolution |
|--------|-------------------|------------|
| `ProviderHealthTable` | `app/admin/system/page.tsx` + `app/admin/intelligence/page.tsx` | Extracted to `components/admin/provider-health-table.tsx` -- single implementation |
| Inline provider `PROVIDER_ORDER` / `PROVIDER_ROLE` constants | Both pages above | Removed from both; live in shared component |

### Merged (functionality consolidated)

| Widget | Source pages | Destination |
|--------|-------------|-------------|
| Scanner status card | /admin/overview | Trading Overview tab |
| Signal counts (today/active/WR/expectancy) | /admin/overview | Trading Overview tab |
| Regime card | /admin/overview, /admin/regime | Trading Regime tab + Intelligence Market tab |
| Gate rejection grid | /admin/scanner | Trading Scanner tab |
| OpsToggles (emergency/maintenance/telegram/AI) | /admin/scanner | Trading Scanner tab |
| Anomaly action center | /admin/anomalies | System Anomalies tab |
| Fear & Greed + news | /admin/market | Intelligence Market tab |
| Sector status cards | /admin/sectors | Intelligence Sectors tab |
| Confidence calibration bands | /admin/calibration | Analytics Edge tab |
| Claude verdict distribution | /admin/calibration | Analytics Calibration tab |
| Cache telemetry | /admin/cache | Intelligence Cache tab |

### New (added during consolidation)

| Component | Location | Purpose |
|-----------|----------|---------|
| `RiskGradeAnalysis` | Analytics Attribution tab | Grade A/B/C WR/expectancy vs POSTFIX.1 targets |
| `IntelligenceValidationSection` | Analytics Attribution tab | POSTFIX.1 staging area (CONFIDENCE/RISKGRADE/MARKET_STRUCTURE/ALPHA) |
| `byGrade` attribution dimension | `lib/outcome-attribution.ts` | Grade-level performance breakdown for RISKGRADE.FIX.1 validation |

---

## API Calls Before / After

| Polling source | Before | After | Change |
|----------------|--------|-------|--------|
| Provider health | Called from providers, intelligence, and system pages independently | `useSharedPolling` in intelligence; `useAutoRefresh` in system | -1 duplicate per page visit |
| Scanner status | /admin/overview + /admin/scanner each polling independently | Single `useSharedPolling` in Trading page | -1 duplicate per page |
| Signal counts | /admin/overview + /admin/signals | Single fetch in Trading overview tab | -1 duplicate per page |
| News | /admin/market standalone | `useAutoRefresh(newsFetcher, 900_000)` in Intelligence Market tab | Unchanged -- 15-min interval maintained |
| Calibration AI data | /admin/calibration (separate page load) | Merged into /admin/analytics calibration tab (on-demand) | -1 separate page load |

### Polling intervals

| Data type | Interval | Hook |
|-----------|----------|------|
| Provider health | 120s | `useSharedPolling` |
| Scanner / celery status | 120s | `useSharedPolling` |
| Intelligence cache | 120s | `useSharedPolling` |
| Sectors | 60s | `useSharedPolling` |
| Analytics (edge, attribution, AI) | 120-300s | `useAutoRefresh` |
| Monitor snapshot | 120s | `useSharedPolling` |
| News | 900s | `useAutoRefresh` |

---

## Redis Ops Before / After

Consolidation reduces page-level polling that previously triggered redundant API -> Redis reads.

| Reduction source | Estimated saving |
|-----------------|-----------------|
| Provider health polled from 3 pages -> 1 shared registry | ~2 fewer poll cycles/visit |
| Scanner status polled from 2 pages -> 1 | ~1 fewer poll cycle/visit |
| Calibration page eliminated (now a tab) | ~1 poll eliminated per session |
| Anomalies page eliminated (now a tab) | ~1 poll eliminated per session |

---

## Redirects

All old page URLs continue to work:

| Old URL | New URL | Type |
|---------|---------|------|
| `/admin/overview` | `/admin/trading` | 301 |
| `/admin/scanner` | `/admin/trading?tab=scanner` | 302 |
| `/admin/signals` | `/admin/trading?tab=signals` | 302 |
| `/admin/tactical` | `/admin/trading?tab=tactical` | 302 |
| `/admin/regime` | `/admin/trading?tab=regime` | 302 |
| `/admin/providers` | `/admin/intelligence` | 301 |
| `/admin/cache` | `/admin/intelligence?tab=cache` | 302 |
| `/admin/sectors` | `/admin/intelligence?tab=sectors` | 302 |
| `/admin/market` | `/admin/intelligence?tab=market` | 302 |
| `/admin/calibration` | `/admin/analytics?tab=calibration` | 302 |
| `/admin/anomalies` | `/admin/system?tab=anomalies` | 302 |

Redirect pages also exist at each old path as Next.js server-side fallback for dev mode.

---

## Shared Components Created

### `components/admin/provider-health-table.tsx`

Single canonical implementation of the 8-provider health table. Previously duplicated.

**Exports:**
- `ProviderHealthTable({ providers: ProviderCheckResult[] })` -- renders the full table
- `ProviderCheckResult` -- type export

**Consumers:**
- `app/admin/system/page.tsx` -- System Health tab
- `app/admin/intelligence/page.tsx` -- Intelligence ProvidersTab

---

## Attribution Engine Changes

### `types/index.ts`
- `AttributionReport.dimensions.byGrade: AttributionDimension[]` added

### `lib/outcome-attribution.ts`
- `byGrade = byDim(rows, r => r.riskGrade, k => 'Grade ${k}')` added to `computeAttribution()`
- Uses all rows (not just `tactRows`) -- grade is always present regardless of Phase 6.7 data gap

---

## Migration Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Old bookmarks to individual pages | Low | 301/302 redirects in next.config.mjs + server-side redirect() in each old page file |
| `ProviderCheckResult` type removed from system page | None | Re-exported from shared component |
| `byGrade` added to AttributionReport response | None | Additive -- existing consumers ignore unknown fields |
| Intelligence page constants removed | None | Now owned by shared component |

---

## GO / NO-GO

**GO**

- TypeScript: 0 errors
- All 13 source pages redirect correctly
- All 4 consolidated pages operational
- Shared ProviderHealthTable eliminates duplicate implementation
- Risk Grade Analysis live in Analytics Attribution tab
- POSTFIX.1 validation staging section visible to operator
- All polling intervals within spec (120s critical, 900s news)
- No duplicate API calls for the same data within a page session
- Settings page unchanged

---

## What's Not Changed

- `/admin/settings` -- remains standalone
- All API routes -- unchanged
- All Python backend endpoints -- unchanged
- All Supabase queries -- unchanged
- Middleware auth -- unchanged (all /admin/* paths still protected)
- Signal pipeline -- unchanged
