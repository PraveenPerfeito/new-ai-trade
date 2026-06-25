# USER.DASHBOARD.1 — Premium Member Dashboard

## Overview

Premium member-facing dashboard for SignalEdge AI. Replaces the old top-nav layout with a fixed sidebar (TradingView/Linear style). Exposes signal feeds, performance analytics, and account settings. Admin-only internals (scanner controls, Redis metrics, gate rejections, feature flags) are never surfaced here.

## Design System

- **Background:** `#070711`
- **Sidebar bg:** `#0c0c13`
- **Cards:** `bg-[#0d0d14] border border-white/[0.07]`
- **Numbers:** `font-mono tabular-nums` everywhere
- **BUY / LONG:** `text-emerald-400` / `border-l-emerald-500`
- **SELL / SHORT:** `text-red-400` / `border-l-red-500`
- **Stat tile labels:** `text-xs uppercase tracking-wider text-gray-500`
- **No backdrop-blur on content cards** — sidebar uses solid bg instead

## Pages

### `/dashboard` — Overview (server component)
4 stat tiles (Active Signals / Win Rate 7D / Expectancy 7D / Signals Today), 2-col layout with recent signals feed + 7D perf snapshot, Telegram alerts card at bottom.

### `/dashboard/signals/active` — Active Signals (client, polls 60s)
Filter chips: All / Long / Short / Spot / Futures / Trending. TradingView-style dense rows with `border-l-2` colored accent. Empty state: pulsing dot + scan cadence message.

### `/dashboard/signals/closed` — Closed Signals (client, re-fetch on period change)
Period selector: 7D / 30D / All. Outcome filter: All / TP Hit / SL Hit / Timeout. R Achieved column shows `+NR` / `-NR`. Duration column shows `8h 24m` format.

### `/dashboard/performance` — Performance Analytics (client)
Period tabs: 7D / 30D / 90D. Hero stat tiles (WR / PF / Exp / Resolved), outcome distribution proportional bar, By Mode + By Grade WR bar tables.

### `/dashboard/settings` — Account Settings (client)
Account info, WhatsApp/Telegram number save (via `auth.updateUser`), plan features list, upgrade CTA, sign out.

## API Endpoints

### `GET /api/member/plan` (existing)
Returns `{ planId, email }`.

### `GET /api/member/performance?period=7d|30d|90d` (new)
Auth-gated. Queries `signal_outcomes` + `signals` tables. Returns:
```json
{
  "period": "7d",
  "totals": { "tp": N, "sl": N, "timeout": N, "total": N, "winRate": 0.34, "profitFactor": 1.23, "expectancy": 0.14 },
  "byMode": [{ "mode": "spot", "n": N, "tp": N, "winRate": 0.4, "expectancy": 0.2, "avgRR": 2.3 }],
  "byGrade": [{ "grade": "A", "n": N, "tp": N, "winRate": 0.45, "expectancy": 0.3 }]
}
```

## Components

### `MemberSidebar` (`components/member/sidebar.tsx`)
Fixed 220px desktop sidebar. Mobile: hamburger + slide-in overlay with backdrop. Active nav item highlighted via `usePathname()`. Footer: plan badge, email, sign-out.

### `OverviewSignalsFeed` (`components/member/overview-signals-feed.tsx`)
One-shot fetch of 5 recent signals. Compact card rows (direction / symbol / grade / confidence / stage / time). No price levels (overview context).

## Shared Utilities

### `lib/member-utils.ts`
- `fmtPx(n)` — price formatter with tier breakpoints ($10k+, $100+, $1+, sub-$1)
- `timeAgo(iso)` — relative time ("2h ago", "just now")
- `fmtDuration(h)` — hours to human string ("8h 24m", "45m")

## Auth Pattern

- **Server components:** `createServerClient` from `@supabase/ssr` + `cookies()` for session; `createSupabaseAdminClient()` for DB queries
- **Client components:** `createSupabaseBrowserClient().auth.getUser()` for user; `fetch('/api/member/...')` for data
- **Performance API:** uses `createServerClient` for auth check, `createSupabaseAdminClient` for DB reads

## Access Control

Member dashboard shows all signals regardless of plan (plan filtering is enforced at API level in `lib/access-control.ts`). No scanner controls, Redis metrics, gate rejections, anomaly data, or feature flags are exposed.

## Bug Fixes (post code-review, June 25)

5 bugs fixed after code-reviewer pass:

| File | Fix |
|------|-----|
| `app/dashboard/page.tsx` | Active count: replaced broken PostgREST `.not('id','in', sqlString)` (re-introduced CLAUDE.md #40 bug) with `total7d - resolvedIds.length` — avoids the PostgREST array-vs-string ambiguity entirely |
| `app/dashboard/signals/active/page.tsx` | Increased fetch limit `50 → 200` so active signals beyond position 50 are not silently invisible when many closed signals exist |
| `app/dashboard/signals/closed/page.tsx` | "Timeout" filter: changed from `lifecycleStage !== 'CLOSED'` (excluded STALE + ANALYZED timed-out signals) to `!(TP_HIT or SL_HIT)` — now shows all non-winner/non-loser outcomes |
| `app/dashboard/settings/page.tsx` | Removed local `type PlanId` re-declaration; now imports canonical `PlanId` from `@/types` to prevent future union-growth crash |
| `components/member/signals-feed.tsx` | Stage badge: `.replace('_', ' ')` → `.replace(/_/g, ' ')` regex to replace all underscores (multi-word stages render correctly) |

## File Map

```
lib/
  member-utils.ts                           ← fmtPx / timeAgo / fmtDuration

app/api/member/
  plan/route.ts                             ← existing — GET /api/member/plan
  performance/route.ts                      ← NEW — GET /api/member/performance?period=7d|30d|90d

components/member/
  sidebar.tsx                               ← NEW — MemberSidebar (desktop fixed + mobile overlay)
  overview-signals-feed.tsx                 ← NEW — OverviewSignalsFeed (5 recent signals, one-shot)
  nav.tsx                                   ← kept as fallback
  signals-feed.tsx                          ← kept (used elsewhere)

app/dashboard/
  layout.tsx                                ← REPLACED — MemberSidebar + lg:ml-[220px] offset
  page.tsx                                  ← REWRITTEN — server component overview with 4 stat tiles
  signals/
    active/page.tsx                         ← NEW — client, 60s polling, dir+mode filter chips
    closed/page.tsx                         ← NEW — client, period selector, outcome filter chips
  performance/page.tsx                      ← NEW — client, period tabs, WR bars by mode+grade
  settings/page.tsx                         ← NEW — client, account + notifications + plan + security

docs/
  USER_DASHBOARD_1.md                       ← this file
```
