# PLATFORM.SIMPLIFICATION.1 — Implementation Notes

**Branch:** `feat/platform-simplification-1`  
**Date:** June 2026  
**Scope:** UI-only. Zero backend changes, zero API changes, zero DB changes.

## What Changed

### Navigation: 5 centers → 3 centers

| Old URL | New URL | Status |
|---|---|---|
| `/admin/trading` | `/admin/signals` | Redirected |
| `/admin/analytics` | `/admin/performance` | Redirected |
| `/admin/intelligence` | `/admin/system?tab=health` | Redirected |
| `/admin/settings` | `/admin/system?tab=settings` | Redirected |
| `/admin/scanner` | `/admin/system?tab=health` | Redirected |
| `/admin/signals` (old) | `/admin/signals` (new) | **Conflict removed** |

### New Centers

#### `/admin/signals` — Signals Center (3 tabs)
- **Overview** — Scanner status, regime, signal counts, recent signals, Founder Command Center
- **Signals** — Merged Signals + Tactical tabs. Lifecycle preset buttons: Active / Sent / Won / Lost / Expired / All. LifecycleFunnel shown. AlphaWatchlist collapsed by default.
- **Regime** — BTC regime + regime hard gate card + apply regime settings

#### `/admin/performance` — Performance Center (3 tabs)
- **Track Record** — 7d/30d/90d WR/Exp/PF, per-mode breakdown, probability accuracy
- **Edge** — Edge validation, confidence calibration bands, intelligence fields
- **Attribution** — Signal attribution by regime/grade/mode/mcap/timeframe + AI effectiveness. Calibration section collapsed inline.

#### `/admin/system` — System Center (3 tabs)
- **Health** — Service grid, provider health, operational metrics, gate rejections, infra config
- **Anomalies** — 4-state anomaly action center
- **Settings** — Quick Controls (3 toggles + 4 number fields) + Operating Mode + Feature Flags grid + Advanced Settings accordion

### Deleted (Phase D)

| Item | Location | Reason |
|---|---|---|
| `app/api/news/grok/route.ts` | API route | News/Grok integration removed |
| `NewsTab` | intelligence/page.tsx | Grok/news integration removed |
| `MarketStructureBreakdown` | system/page.tsx | Operational noise, rarely actioned |
| `IntelligenceValidationSection` | analytics/page.tsx | Staging component, not production-relevant |
| `ProbabilityTab` | analytics/page.tsx | Duplicate of Track Record tab |
| BUY/SELL balance chips | trading/page.tsx | Low-signal noise |
| Confidence distribution strip | trading/page.tsx | Low-signal noise |

### Old Pages Deleted

`app/admin/trading/page.tsx`, `app/admin/analytics/page.tsx`, `app/admin/intelligence/page.tsx`, `app/admin/settings/page.tsx` — all deleted. Routes handled by `next.config.mjs` redirects.

## What Was NOT Changed

- Zero Python backend files changed
- Zero API route handlers changed
- Zero DB schema changes
- Zero signal generation logic changed
- All polling keys, API endpoints, and data flows preserved

## Remaining After Merge

- Phase C (signal card simplification to ~12 primary + collapsible More) — deferred; requires careful UX testing
- TelegramDeliveryCard — removed from ScannerTab, not yet re-surfaced anywhere; consider adding to System > Health collapsed
