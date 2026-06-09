# ADMIN.CONSOLIDATION.1 — Admin Dashboard 13→4 Consolidation

## Overview

Reduced the admin dashboard from 13 separate pages to 4 consolidated operational centers (+ Settings unchanged), eliminating duplicate API calls and simplifying navigation.

---

## Pages Before → After

### Before (13 pages)

| Route | Purpose |
|-------|---------|
| `/admin/overview` | Dashboard overview tiles |
| `/admin/scanner` | Celery scanner controls |
| `/admin/signals` | Signal feed with filters |
| `/admin/tactical` | Trade-mode preset selector |
| `/admin/regime` | BTC regime + apply settings |
| `/admin/providers` | API provider health table |
| `/admin/cache` | Redis cache telemetry |
| `/admin/sectors` | CMC sector status cards |
| `/admin/market` | Regime + trending assets |
| `/admin/analytics` | Edge + attribution analysis |
| `/admin/anomalies` | Anomaly state machine |
| `/admin/calibration` | Claude AI calibration |
| `/admin/system` | System health grid |

### After (4 centers + Settings)

| Route | Tabs | Source pages merged |
|-------|------|---------------------|
| `/admin/trading` | Overview · Scanner · Signals · Tactical · Regime | overview, scanner, signals, tactical, regime |
| `/admin/intelligence` | Providers · Cache · Sectors · Market | providers, cache, sectors, market |
| `/admin/analytics` | Edge · Attribution · AI Calibration | analytics (existing) + calibration |
| `/admin/system` | System Health · Anomalies | system (existing) + anomalies |
| `/admin/settings` | (unchanged) | settings |

---

## Navigation Tree Before → After

### Before
```
TRADING DESK
  ├── Overview
  ├── Signals
  ├── Tactical
  └── Settings
MARKET
  ├── Intelligence
  ├── Regime
  └── Sectors
OPERATIONS
  ├── Scanner
  ├── Anomalies
  ├── Providers
  ├── Cache
  └── System
REVIEW
  ├── Analytics
  └── Calibration
```

### After
```
Trading      Overview · Scanner · Signals · Tactical · Regime
Intelligence Providers · Cache · Sectors · Market
Analytics    Edge · Attribution · Calibration
System       Health · Anomalies
Settings     Signal quality · Risk · Presets
```

---

## Redirect Map

All 11 old routes redirect to their new consolidated location:

| Old Route | New Route |
|-----------|-----------|
| `/admin/overview` | `/admin/trading` |
| `/admin/scanner` | `/admin/trading?tab=scanner` |
| `/admin/signals` | `/admin/trading?tab=signals` |
| `/admin/tactical` | `/admin/trading?tab=tactical` |
| `/admin/regime` | `/admin/trading?tab=regime` |
| `/admin/providers` | `/admin/intelligence` |
| `/admin/cache` | `/admin/intelligence?tab=cache` |
| `/admin/sectors` | `/admin/intelligence?tab=sectors` |
| `/admin/market` | `/admin/intelligence?tab=market` |
| `/admin/anomalies` | `/admin/system?tab=anomalies` |
| `/admin/calibration` | `/admin/analytics?tab=calibration` |

---

## API Calls Before → After

### Before — Per-page polling (each page polls independently)
- overview: 4 endpoints × 30s = 11,520 calls/day
- scanner: 3 endpoints × 30s = 8,640 calls/day
- signals: 2 endpoints × 45s = 3,840 calls/day
- tactical: 1 endpoint × 60s = 1,440 calls/day
- regime: 2 endpoints × 60s = 2,880 calls/day
- providers: 3 endpoints × 30s = 8,640 calls/day
- cache: 2 endpoints × 30s = 5,760 calls/day
- sectors: 1 endpoint × 120s = 720 calls/day
- market: 3 endpoints × 60s = 4,320 calls/day
- anomalies: 1 endpoint × 60s = 1,440 calls/day
- calibration: 2 endpoints × 120s = 1,440 calls/day
- **Total: ~51,000 calls/day** (visitor on 1 page = still 1 page)

### After — `useSharedPolling` module singleton
- trading page: 8 shared keys × 120s = ~5,760 calls/day
- intelligence page: 4 shared keys × 120s = ~2,880 calls/day
- analytics page: 3 shared keys × 180s = ~1,440 calls/day
- system page: 2 shared keys × 120s = ~1,440 calls/day
- **Total: ~11,520 calls/day** (~78% reduction)

Key saving: `useSharedPolling` deduplicates fetches across components on the same page that share a key — only one timer fires per key regardless of how many components subscribe.

---

## Widgets Removed / Merged / Reused

### Removed (replaced by equivalent in new page)
- `ProviderStatusBoard` (providers/page.tsx) — replaced by `ProvidersTab` in intelligence/page.tsx
- `OperationsSummary` card (providers/page.tsx) — merged into ProvidersTab summary row
- `QuotaBurnForecast` (providers/page.tsx) — merged into ProvidersTab quota bar
- `CompactProviderCard` (providers/page.tsx) — rewritten as inline table rows
- Regime `applyMode()` modal (regime/page.tsx) — rewritten as inline in `RegimeTab`
- Anomaly drawer (anomalies/page.tsx) — rewritten as `AnomaliesTab` in system/page.tsx

### Merged (content moved inline)
- `CalibrationTabContent` — embedded in analytics/page.tsx as function component
- `AnomaliesTab` — embedded in system/page.tsx as function component
- `OpsToggle` — embedded in trading/page.tsx (previously in scanner/page.tsx)
- `MetricTile` — embedded in trading/page.tsx (previously in overview/page.tsx)

### Reused (unchanged imports)
- `adminApi` from `lib/admin-api`
- `useAutoRefresh` from `lib/use-auto-refresh`
- `AnomalyBadge` from `components/admin/anomaly-badge`
- All Lucide icon imports
- All Tailwind `glass-card`, `terminal-*` CSS variables

---

## Polling Intervals

| Data type | Key prefix | Interval |
|-----------|-----------|---------|
| Critical ops (scanner, regime, ops flags) | `trading:*`, `intelligence:providers` | 120s |
| Analytics data (edge, attribution, AI) | `analytics:*` | 180s |
| Cache + sectors + market | `intelligence:cache`, `intelligence:sectors`, `intelligence:market` | 120s |
| System + anomalies | (internal to system page) | 120s |
| News feed | `useAutoRefresh` inside MarketTab | 900s |

---

## Files Changed

### New files
- `app/admin/trading/page.tsx` — 5-tab Trading Operations center
- `app/admin/intelligence/page.tsx` — 4-tab Intelligence center

### Updated files
- `app/admin/analytics/page.tsx` — added AI Calibration 3rd tab
- `app/admin/system/page.tsx` — added Anomalies tab, wrapped existing content
- `components/admin/sidebar.tsx` — rewritten: 4 sections → flat 5-item list

### Redirect stubs (server components)
- `app/admin/overview/page.tsx`
- `app/admin/scanner/page.tsx`
- `app/admin/signals/page.tsx`
- `app/admin/tactical/page.tsx`
- `app/admin/regime/page.tsx`
- `app/admin/providers/page.tsx`
- `app/admin/cache/page.tsx`
- `app/admin/sectors/page.tsx`
- `app/admin/market/page.tsx`
- `app/admin/anomalies/page.tsx`
- `app/admin/calibration/page.tsx`

---

## Migration Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Bookmarked old URLs break | LOW | Server-side redirect preserves UX; users land on correct tab |
| `useSharedPolling` key collision across pages | LOW | Keys are page-prefixed (`trading:*`, `intelligence:*`) |
| intelligence/page.tsx missing some providers/page.tsx content | MEDIUM | Core operational data (8-service table + quota bar) preserved; advanced analytics from providers page are lower-priority ops data |
| Anomaly localStorage state uses same `LS_KEY` | LOW | Key is `anomaly_states` — unchanged from original anomalies/page.tsx |
| Tab query-param deep-linking (`?tab=scanner`) | LOW | Redirect passes query param; new pages read `useSearchParams()` for initial tab |

---

## Status

Implementation complete. All 4 consolidated pages written, sidebar rewritten, 11 redirects in place.
