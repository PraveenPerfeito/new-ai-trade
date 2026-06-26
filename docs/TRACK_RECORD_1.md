# TRACK_RECORD.1 — Public Performance Transparency

**Date:** 2026-06-25  
**Status:** SPEC — ready to implement  
**Scope:** Public `/performance` page + `/api/public/track-record` endpoint. No auth required. Zero changes to scanner, signals, or admin paths.

---

## SECTION 1 — Objective

Surface real, database-derived performance metrics to build credibility with prospective subscribers. Traders expect verifiable track records before paying for a signal service. Every number shown traces directly to the `signal_outcomes` table — no manual adjustments, no cherry-picking.

---

## SECTION 2 — What to Show / What to Hide

### SHOW — public transparency

| Data | Reason |
|------|--------|
| Win rate (7D / 30D / 90D / all-time) | Core credibility metric |
| Profit factor | Demonstrates reward/risk quality |
| Expectancy (in R) | Shows edge per trade |
| Total closed signals count | Sample size = credibility |
| Monthly results table (last 12 months) | Consistency over time |
| Closed signal log — symbol, direction, outcome, R achieved, duration, close date | Verifiability |
| Outcome breakdown (wins / losses / timeouts) | Full honesty |
| BUY vs SELL split (WR by direction) | Shows no directional bias |
| "Source: database-derived, no manual adjustments" attribution line | Trust |

### HIDE — internal logic protection

| Data | Reason hidden |
|------|--------------|
| Entry price, target price, stop loss | Front-running risk on open signals |
| Confidence scores | Reveals internal scoring engine |
| Scanner modes (spot/futures/trending) | Reveals strategy architecture |
| Risk grades (A/B/C) | Reveals internal grading system |
| AI validation flag / reasoning | Reveals AI decision pipeline |
| Gate names and rejection counts | Reveals filter logic |
| Empirical cohort data | Reveals probability model inputs |
| Per-user delivery data | Privacy |
| Open / active signals | Front-running risk |
| Setup scores, ADX, indicator values | Reveals signal criteria |

**Rule:** If a field exists only inside the scanner pipeline, hide it. If it describes a completed trade outcome, show it.

---

## SECTION 3 — Page: `/performance`

Public route. No authentication. No Supabase session check.

### 3.1 Layout

```
/performance
│
├── HERO — 30D headline stats (default)  [7D | 30D | 90D | All-time] toggle
│   ├── Win Rate          34.8%
│   ├── Profit Factor     1.21
│   ├── Expectancy       +0.09R
│   └── Resolved          2,130 signals
│
├── MONTHLY RESULTS — last 12 months
│   Month     Signals   Win Rate   Profit Factor   Expectancy
│   Jun 2026     178      33.5%        1.23           +0.14R
│   May 2026     401      36.2%        1.31           +0.19R
│   ...
│
├── SIGNAL LOG — last 50 closed signals (paginated)  [BUY | SELL | All]  [TP | SL | All]
│   Symbol    Dir    Outcome    R      Duration    Closed
│   BTC       BUY    TP HIT    +2.1R    6h        Jun 23
│   ETH       SELL   SL HIT   -1.0R    2h        Jun 23
│   ...       ...    ...        ...      ...       ...
│   [Load more — 50 per page]
│
└── FOOTER
    "All data sourced directly from the SignalEdge AI database.
     No manual adjustments. Past performance does not guarantee future results."
    [Verified by database · Updated every 15 minutes]
```

### 3.2 Window toggle behaviour

Selecting 7D / 30D / 90D updates only the hero stats row. Monthly table and signal log are independent of the window toggle (always show last 12 months / last 50 respectively).

"All-time" queries the full `signal_outcomes` table without a date filter.

### 3.3 Signal log fields (public-safe)

| Field | Source | Notes |
|-------|--------|-------|
| `symbol` | `signal_outcomes.symbol` | e.g. "BTC/USDT" |
| `signal_type` | `signal_outcomes.signal_type` | BUY or SELL |
| `outcome` | `signal_outcomes.outcome` | DB value is `TP_HIT` / `SL_HIT` / `TIMEOUT` — display as `outcome.replace(/_/g, ' ')` → `TP HIT` / `SL HIT` / `TIMEOUT` |
| `rr_achieved` | `signal_outcomes.rr_achieved` | e.g. +2.1R or -1.0R |
| `duration_hours` | `signal_outcomes.duration_hours` | formatted: "4h" / "2d 3h" |
| `resolved_at` | `signal_outcomes.resolved_at` | date only, no time (privacy) |

**Delay:** Signal log entries appear only when `resolved_at < NOW() - INTERVAL '1 hour'`. Prevents any information about open signals leaking through race conditions.

---

## SECTION 4 — Public API: `GET /api/public/track-record`

### 4.1 Route

```
GET /api/public/track-record
Auth: none
Rate limit: 60 requests/minute per IP (Next.js middleware)
Cache: 15-minute Redis cache (key: public:track-record)
```

Not under `/api/analytics/` (protected) or `/api/admin/`. Sits at `/api/public/` — a new unprotected prefix.

**Middleware change:** Add `'/api/public'` to the list of explicitly NOT protected paths (it currently falls through as unprotected — confirm this in `middleware.ts`).

### 4.2 Response shape

```typescript
interface PublicTrackRecord {
  windows: {
    d7:       TrackWindow;
    d30:      TrackWindow;
    d90:      TrackWindow;
    all_time: TrackWindow;
  };
  by_month: MonthRow[];           // last 12 months, newest first
  by_direction: {
    buy:  { n: number; wr: number | null };
    sell: { n: number; wr: number | null };
  };
  source:     string;             // "signal_outcomes · no manual adjustments"
  updated_at: string;             // ISO timestamp of last cache refresh
}

interface TrackWindow {
  resolved:    number;
  wins:        number;
  losses:      number;
  timeouts:    number;
  win_rate:    number | null;     // percent (0–100)
  profit_factor: number | null;
  expectancy:  number | null;     // in R
}

interface MonthRow {
  month:          string;         // "2026-06"
  resolved:       number;
  wins:           number;
  win_rate:       number | null;
  profit_factor:  number | null;
  expectancy:     number | null;
}
```

**Explicitly omitted from response:** `scanner_mode`, `confidence`, `risk_grade`, `ai_validated`, `entry_price`, `target_price`, `stop_loss`, `probability_accuracy`, `by_mode`.

### 4.3 `GET /api/public/closed-signals`

```
GET /api/public/closed-signals?page=1&limit=50&type=BUY|SELL&outcome=TP_HIT|SL_HIT
Auth: none
Cache: 5-minute Redis cache per query param combination
```

```typescript
interface PublicSignalLog {
  signals: PublicClosedSignal[];
  total:   number;
  page:    number;
}

interface PublicClosedSignal {
  symbol:         string;
  signal_type:    'BUY' | 'SELL';
  outcome:        'TP_HIT' | 'SL_HIT' | 'TIMEOUT';
  rr_achieved:    number;
  duration_hours: number;
  resolved_date:  string;   // date only: "2026-06-23"
}
```

---

## SECTION 5 — Backend SQL

### 5.1 Window query (reused for all time windows)

```sql
SELECT
  COUNT(*)                                                AS resolved,
  COUNT(*) FILTER (WHERE outcome = 'TP_HIT')             AS wins,
  COUNT(*) FILTER (WHERE outcome IN ('SL_HIT','TIMEOUT')) AS losses,
  COUNT(*) FILTER (WHERE outcome = 'TIMEOUT')            AS timeouts,

  -- Win rate %
  ROUND(
    COUNT(*) FILTER (WHERE outcome = 'TP_HIT')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100,
  2)                                                     AS win_rate,

  -- Profit factor = gross_profit / gross_loss
  ROUND(
    SUM(rr_achieved) FILTER (WHERE rr_achieved > 0)
    / NULLIF(ABS(SUM(rr_achieved) FILTER (WHERE rr_achieved < 0)), 0),
  3)                                                     AS profit_factor,

  -- Expectancy = (WR × avg_win) − (LR × avg_loss)
  ROUND(
    (COUNT(*) FILTER (WHERE outcome = 'TP_HIT')::NUMERIC / NULLIF(COUNT(*), 0))
    * AVG(rr_achieved) FILTER (WHERE rr_achieved > 0)
    -
    (COUNT(*) FILTER (WHERE outcome IN ('SL_HIT','TIMEOUT'))::NUMERIC / NULLIF(COUNT(*), 0))
    * ABS(AVG(rr_achieved) FILTER (WHERE rr_achieved <= 0)),
  4)                                                     AS expectancy

FROM signal_outcomes
WHERE outcome != 'PENDING'
  AND resolved_at >= NOW() - INTERVAL '<window>'   -- '7 days' / '30 days' / '90 days' / omit for all-time
  AND resolved_at < NOW() - INTERVAL '1 hour';     -- exclude very recent (race condition guard)
```

### 5.2 Monthly breakdown query

```sql
SELECT
  TO_CHAR(DATE_TRUNC('month', resolved_at), 'YYYY-MM')   AS month,
  COUNT(*)                                                AS resolved,
  COUNT(*) FILTER (WHERE outcome = 'TP_HIT')             AS wins,
  ROUND(
    COUNT(*) FILTER (WHERE outcome = 'TP_HIT')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100,
  2)                                                     AS win_rate,
  ROUND(
    SUM(rr_achieved) FILTER (WHERE rr_achieved > 0)
    / NULLIF(ABS(SUM(rr_achieved) FILTER (WHERE rr_achieved < 0)), 0),
  3)                                                     AS profit_factor,
  ROUND(
    (COUNT(*) FILTER (WHERE outcome = 'TP_HIT')::NUMERIC / NULLIF(COUNT(*), 0))
    * AVG(rr_achieved) FILTER (WHERE rr_achieved > 0)
    -
    (COUNT(*) FILTER (WHERE outcome IN ('SL_HIT','TIMEOUT'))::NUMERIC / NULLIF(COUNT(*), 0))
    * ABS(AVG(rr_achieved) FILTER (WHERE rr_achieved <= 0)),
  4)                                                     AS expectancy

FROM signal_outcomes
WHERE outcome != 'PENDING'
  AND resolved_at >= NOW() - INTERVAL '12 months'
  AND resolved_at < NOW() - INTERVAL '1 hour'
GROUP BY DATE_TRUNC('month', resolved_at)
ORDER BY DATE_TRUNC('month', resolved_at) DESC;
```

### 5.3 By-direction query

```sql
SELECT
  signal_type,
  COUNT(*)                                              AS n,
  ROUND(
    COUNT(*) FILTER (WHERE outcome = 'TP_HIT')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100,
  2)                                                   AS wr
FROM signal_outcomes
WHERE outcome != 'PENDING'
  AND resolved_at >= NOW() - INTERVAL '30 days'
  AND resolved_at < NOW() - INTERVAL '1 hour'
GROUP BY signal_type;
```

### 5.4 Signal log query

```sql
SELECT
  symbol,
  signal_type,
  outcome,
  ROUND(rr_achieved::NUMERIC, 2)          AS rr_achieved,
  ROUND(duration_hours::NUMERIC, 1)       AS duration_hours,
  resolved_at::DATE                       AS resolved_date
FROM signal_outcomes
WHERE outcome != 'PENDING'
  AND resolved_at < NOW() - INTERVAL '1 hour'
  -- optional filters applied here (signal_type, outcome)
ORDER BY resolved_at DESC
LIMIT 50 OFFSET $offset;
```

---

## SECTION 6 — Caching Strategy

| Data | Cache key | TTL | Reason |
|------|-----------|-----|--------|
| Track record windows | `public:track-record:windows` | 15 min | Low-change; expensive query |
| Monthly breakdown | `public:track-record:months` | 15 min | Changes at most once/month near end of month |
| By-direction | `public:track-record:direction` | 15 min | Batch with windows call |
| Signal log page 1 | `public:signals:p1` | 5 min | Updates as signals resolve |
| Signal log page N | `public:signals:p{N}` | 5 min | — |

All queries run against Supabase (asyncpg pool). The public endpoint is **Next.js only** (no Python backend call needed) — connects to Supabase directly via `SUPABASE_SERVICE_ROLE_KEY` with the existing `createSupabaseAdminClient()`.

**Rate limit:** Simple IP-based counter in middleware: 60 req/min. Return 429 with `Retry-After: 60` header.

---

## SECTION 7 — Frontend Components

### 7.1 `app/performance/page.tsx`

```
'use server' (Server Component — SEO friendly, no auth check)

Fetches:
  - GET /api/public/track-record  (windows + months + direction)
  - GET /api/public/closed-signals?page=1

Renders:
  - <PerformanceHero>      — window selector + stat tiles
  - <MonthlyTable>         — 12-month results
  - <SignalLogTable>        — last 50 resolved signals
  - <TrackRecordDisclaimer> — data source + disclaimer
```

### 7.2 `<PerformanceHero>` component

```tsx
// Stat tiles: Win Rate | Profit Factor | Expectancy | Total Closed
// Window tabs: [7D] [30D] [90D] [All-time]
// Direction chips: BUY 36.1% · SELL 33.4% (30D)
// Color coding: ≥50% green · ≥40% blue · ≥30% amber · <30% red
```

### 7.3 `<MonthlyTable>` component

Columns: **Month · Signals · Win Rate · Profit Factor · Expectancy**  
Color: win_rate column uses the same 4-tier color scale.  
Empty state: "No completed signals yet for this month."

### 7.4 `<SignalLogTable>` component

Columns: **Symbol · Direction · Outcome · R · Duration · Date**  
Filters: BUY / SELL toggle · TP HIT / SL HIT / All toggle  
Pagination: "Load 50 more" button (appends, no page reload)  
Outcome badge: ✓ +2.1R (green) / ✗ -1.0R (red) / ⏱ -1.0R (zinc for TIMEOUT)

### 7.5 `<TrackRecordDisclaimer>` component

```
All metrics computed directly from the SignalEdge AI database.
No manual adjustments. No signal cherry-picking.
Sample: 2,130 resolved signals · Source: signal_outcomes table
Updated: 15 minutes ago · [?] How outcomes are determined

Past performance does not guarantee future results.
Cryptocurrency trading involves substantial risk of loss.
```

"How outcomes are determined" expands a tooltip:
> "A signal is marked TP HIT when price touches the target. SL HIT when price touches the stop. TIMEOUT when neither occurs within the signal's timeframe window (1h: 8h, 4h: 24h, 1d: 72h). Checked automatically every 30 minutes."

---

## SECTION 8 — Navigation Integration

### 8.1 Add to public navbar

```tsx
// In the landing page / public layout nav:
<nav>
  <a href="/">Home</a>
  <a href="/performance">Track Record</a>   ← NEW
  <a href="/pricing">Pricing</a>
</nav>
```

### 8.2 Landing page callout

Add a performance snapshot section between the feature list and pricing on `/`:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Verified Track Record                       [View full history →]
  
  34.8%          1.21         +0.09R          2,130
  Win Rate       Profit       Expectancy      Closed
  (30D)          Factor       per trade       signals
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Numbers pull from `/api/public/track-record` (d30 window). Static fallback if API unavailable (show "-" not 0).

---

## SECTION 9 — Implementation Steps

### Step 1 — API routes (Next.js)
Create `app/api/public/track-record/route.ts`:
- Query Supabase via `createSupabaseAdminClient()`
- Run window + monthly + direction queries
- Cache result in Redis (`lib/cache.ts` `getOrSet()`)
- Return `PublicTrackRecord` shape

Create `app/api/public/closed-signals/route.ts`:
- Query signal log with pagination + filters
- Cache per query params

### Step 2 — Confirm middleware passthrough
Verify `middleware.ts` does not apply admin auth to `/api/public/`. Add explicit comment:
```typescript
// /api/public/* — intentionally public, no auth required
```

### Step 3 — Frontend page
Create `app/performance/page.tsx` as Server Component.  
Create child components: `PerformanceHero`, `MonthlyTable`, `SignalLogTable`, `TrackRecordDisclaimer`.

### Step 4 — Navigation
Add "Track Record" link to public navbar in landing page layout.  
Add performance snapshot section to `app/page.tsx`.

### Step 5 — Verify data quality
Before launch, confirm in Supabase SQL Editor:
```sql
SELECT COUNT(*), outcome FROM signal_outcomes
WHERE outcome != 'PENDING'
GROUP BY outcome;
```
Expect: TP_HIT, SL_HIT, TIMEOUT all populated. If any outcome is 0 for 7D window, delay launch until sample is meaningful (target: ≥30 resolved in 7D).

---

## SECTION 10 — Files to Create / Modify

### New files
| File | Description |
|------|-------------|
| `app/api/public/track-record/route.ts` | Public track record API |
| `app/api/public/closed-signals/route.ts` | Public signal log API |
| `app/performance/page.tsx` | Public performance page (Server Component) |
| `components/public/performance-hero.tsx` | Stat tiles + window toggle |
| `components/public/monthly-table.tsx` | Monthly results table |
| `components/public/signal-log-table.tsx` | Closed signal log |
| `components/public/track-record-disclaimer.tsx` | Source attribution + disclaimer |

### Modified files
| File | Change |
|------|--------|
| `app/page.tsx` | Add performance snapshot section |
| `app/(public)/layout.tsx` or nav component | Add "Track Record" nav link |
| `middleware.ts` | Add comment confirming `/api/public/` passthrough |

---

## SECTION 11 — Open Items

| ID | Item | Priority |
|----|------|----------|
| OI-1 | Minimum sample guard: if `resolved < 10` for a window, show "Insufficient data" instead of misleading small-sample stats | P0 |
| OI-2 | Rate limiting: implement IP-based 60 req/min in middleware or a dedicated rate-limit helper (no external service needed) | P1 |
| OI-3 | SEO: add `<meta>` description + structured data (Schema.org `FinancialService` or `Dataset`) for discoverability | P2 |
| OI-4 | RSS/JSON feed: `/api/public/track-record.json` with `Cache-Control: public, max-age=900` for third-party aggregators | P3 |
| OI-5 | "Audited by" badge: future external audit integration (e.g. FX Blue) — hook point in disclaimer component | P3 |

---

*Estimated implementation: 1 day.*  
*No scanner changes. No admin changes. No DB migrations required (reads existing `signal_outcomes` table).*
