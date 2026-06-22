# PRODUCTION.TRUTH.FIXES.1
<!-- Audit: PRODUCTION.TRUTH.VERIFICATION.1 second-pass (2026-06-22) → 4 P0 fixes -->

## Summary

All 4 P0 issues from the PRODUCTION.TRUTH.VERIFICATION.1 second-pass addendum are **resolved**. Two were fixed during the same audit session; two were fixed in a subsequent pass and are documented here.

---

## P0-NEW-01 — `flags.telegram` always `false` (SystemStatusBanner permanently "TELEGRAM OFF")

**Root cause:** `flagsFetcher` in `signals/page.tsx` fetched only `features` group and read `field(featRes, 'telegram')`. The `features` group has no `telegram` key — that key lives in `telegram.alerts_enabled`. `field()` returns `undefined` → `Boolean(undefined) === false` → permanently false.

**File:** `app/admin/signals/page.tsx` line ~2207

**Before:**
```ts
const [featRes, aiRes] = await Promise.all([
  adminApi.settings.group('features'),
  adminApi.settings.group('ai'),
])
return {
  telegram: Boolean(field(featRes, 'telegram')),  // wrong group — always false
```

**After:**
```ts
const [featRes, aiRes, teleRes] = await Promise.all([
  adminApi.settings.group('features'),
  adminApi.settings.group('ai'),
  adminApi.settings.group('telegram'),             // correct group
])
return {
  telegram: Boolean(field(teleRes, 'alerts_enabled')),  // correct key
```

**Validation query:**
```sql
SELECT value FROM settings_groups WHERE group_name='telegram' AND key='alerts_enabled';
```
Expected: `true` when alerts are on. SystemStatusBanner should show "WhatsApp ON" (not "TELEGRAM OFF").

**Risk:** Zero — read-only change to flags fetcher. No backend changes.

---

## P0-NEW-02 — LifecycleFunnel "Generated" capped at 200, not true DB total

**Root cause:** `LifecycleFunnel` computed `generated = signals.length` (the client-side array, capped at `limit=200`). When 7d window has 300+ signals, funnel showed "Generated: 200" and downstream conversion rates (Sent%, Active%) were wrong.

**File:** `app/admin/signals/page.tsx` line ~1680

**Before:**
```tsx
function LifecycleFunnel({ signals }: { signals: TacticalSignalRow[] }) {
  const generated = signals.length  // capped at limit=200
```

**After:**
```tsx
function LifecycleFunnel({ signals, dbTotal }: { signals: TacticalSignalRow[]; dbTotal?: number | null }) {
  // P0-NEW-02: use DB total when available so funnel isn't capped at client limit=200
  const generated = dbTotal ?? signals.length
```

Call site (`signals/page.tsx` line ~1330):
```tsx
<LifecycleFunnel signals={signals ?? []} dbTotal={dbTotal} />
```

`dbTotal` is already returned by `/api/signals/tactical` (the count of all signals in the 7d window matching `minConfidence`) and stored in `feed.dbTotal`.

**Validation query:**
```sql
SELECT COUNT(*) FROM signals
WHERE confidence >= 80 AND created_at >= NOW() - INTERVAL '7 days';
```
Compare this number to the "Generated" funnel step — they should match.

**Risk:** Zero — display-only. No API/DB changes.

---

## P0-NEW-03 — LifecycleFunnel double-counts `TELEGRAM_SENT` → Active > Sent paradox

**Root cause:** The `active` filter included `s.lifecycleStage === 'TELEGRAM_SENT'`. Since `TELEGRAM_SENT` signals are also counted in `sent` (via `s.telegramSent === true`), those signals appeared in both buckets. With a small sample, Active > Sent was mathematically possible, producing >100% conversion.

**File:** `app/admin/signals/page.tsx` line ~1694

**Before:**
```ts
const active = signals.filter(s =>
  s.lifecycleStage === 'ACTIVE' || s.lifecycleStage === 'TELEGRAM_SENT'
).length
```

**After:**
```ts
// P0-NEW-03: TELEGRAM_SENT must not be in active — it's already counted in sent
const active = signals.filter(s => s.lifecycleStage === 'ACTIVE').length
```

**Invariant:** After fix, `active ≤ sent` always holds because ACTIVE signals are a temporal subset of sent signals (ACTIVE = past the 30-min TELEGRAM_SENT window, still within the timeframe window).

**Risk:** Zero — display-only.

---

## P0-NEW-04 — Tactical route outcome map non-deterministic (resolved signals appear ACTIVE)

**Root cause:** The `signal_outcomes` query had no `.neq('outcome', 'PENDING')` filter. Every signal gets a PENDING row on insert. If DB returned the PENDING row last in the iteration, `outcomeMap.set(signal_id, pendingRow)` would overwrite the actual resolved outcome. PostgreSQL row order is undefined without `ORDER BY`, so this was intermittent — resolved signals occasionally showed as ACTIVE depending on the execution plan.

**File:** `app/api/signals/tactical/route.ts` line ~44

**Before:**
```ts
const { data: outcomes } = await admin
  .from('signal_outcomes')
  .select('signal_id, outcome, rr_achieved, pnl_pct, duration_hours')
  .in('signal_id', ids)
  // no PENDING filter — PENDING rows could overwrite resolved rows
```

**After:**
```ts
const { data: outcomes } = await admin
  .from('signal_outcomes')
  .select('signal_id, outcome, rr_achieved, pnl_pct, duration_hours')
  .in('signal_id', ids)
  .neq('outcome', 'PENDING')  // P0-NEW-04: exclude PENDING rows
```

**Validation query:**
```sql
-- Signals with both PENDING and non-PENDING outcomes (the problematic case)
SELECT signal_id, array_agg(outcome) as outcomes
FROM signal_outcomes
GROUP BY signal_id
HAVING COUNT(*) > 1 AND 'PENDING' = ANY(array_agg(outcome));
```
After fix: signals in this set must show their non-PENDING outcome (TP_HIT/SL_HIT/TIMEOUT), never ACTIVE.

**Risk:** Low — this is the correct semantic. A signal with a non-PENDING outcome is resolved; ACTIVE requires the absence of any resolved row.

---

## First-Pass P0s (resolved 2026-06-19, commits `9457738` + `57e9cea`)

| ID | Issue | Fix | Commit |
|----|-------|-----|--------|
| Grade D bug | Probability gate used global cohort grade (~20% WR → Grade D) → suppressed ALL alerts | `_regime_grade` from regime-level cohort only; `None` when n<30 → no suppress | `9457738` |
| FG-01 | counts route queried `return_r` (non-existent) → all metrics 0 | `rr_achieved` | `57e9cea` |
| FG-02 | win_rate_7d excluded TIMEOUT from denominator → inflated vs Edge tab | Added TIMEOUT to `.in()` filter | `57e9cea` |
| H-02 | `features.ai_validation` (non-existent) → AI banner always OFF | Read from `ai.enabled` | `57e9cea` |
| PC-03 | `sharpe` (TS) vs `sharpe_ratio` (Python) → Sharpe always blank | Renamed to `sharpe_ratio` | `57e9cea` |
| PC-04 | `generated_at` (TS) vs `report_date` (Python) → timestamp blank | Read `report_date ?? generated_at` | `57e9cea` |
| H-11 | `win_rate` rendered as raw float `42.857142857%` | `.toFixed(1)` | `57e9cea` |

---

*PRODUCTION.TRUTH.FIXES.1 completed: 2026-06-22 · all 11 P0 findings resolved*
