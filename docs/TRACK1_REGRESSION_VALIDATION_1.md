# TRACK1.REGRESSION.VALIDATION.1

**Date:** 2026-06-29
**Scope:** Verify SAAS.POSITIONING.1 + USER.DASHBOARD.1 (commit `b69c987`) did not break the production trading platform.
**Result:** 3 regressions found and fixed. Platform production-safe post-fix.

---

## Commits Reviewed (last 10)

| Commit | Description |
|--------|-------------|
| `8fdce01` | fix: ADMIN.FOUNDER.1 — 3 admin system page bug fixes |
| `11ebe3b` | docs: DOC.TRUTH.4 — 9 doc bug fixes |
| `cd98050` | docs: TRACK_RECORD.1 spec |
| `a59cafc` | feat: SUBSCRIPTION.BILLING.1 DB migration |
| `c588264` | docs: SUBSCRIPTION.BILLING.1 spec |
| `a8b4d2c` | docs: DOC.TRUTH.3 |
| `51e25bb` | docs: DOC.TRUTH.2 |
| **`b69c987`** | **feat: SAAS.POSITIONING.1 + USER.DASHBOARD.1 ← risk commit** |
| `281677f` | docs: WHATSAPP env vars + REDIS.REDUCE |
| `6f3f2fc` | docs: DOC.TRUTH.1 |

Key risk commit: `b69c987` modified `middleware.ts`, `lib/access-control.ts`, and added 9 new files under `/dashboard/` and `/api/member/`.

---

## Regressions Found and Fixed

### CRIT-1 — Free users bypassed plan confidence threshold via `/api/signals/tactical`

**File:** `app/api/signals/tactical/route.ts`
**Root cause:** Before `b69c987`, this route was only called by the admin dashboard (enterprise plan, no limits). The new member dashboard pages (`/dashboard/signals/active` and `/dashboard/signals/closed`) call the same route directly. The route had no plan-based filtering — a free-tier user could receive all signals at any confidence level by hitting `/api/signals/tactical?minConfidence=70`.

**Fix:** Added `getAccessContext(req)` import and call. Computes `effectiveMinConf = Math.max(minConfidence, ctx.plan.minSignalConfidence)` and applies it at both the DB count query and `getRecentSignals()` call.

**Admin impact:** None. Enterprise plan `minSignalConfidence = 70` — admin query params are always ≥70, so `Math.max(param, 70) = param`. Identical behavior to before.

**Member impact:** Free users (threshold 85) and Pro users (threshold 75) now see only signals they are entitled to.

---

### CRIT-2 — Admin proxy missing `export const runtime = 'nodejs'`

**File:** `app/api/admin/[...path]/route.ts`
**Root cause:** Architecture decision #4 requires all API routes to set `runtime = 'nodejs'`. The admin proxy lacked this declaration. Without it Next.js may default to Edge runtime on Vercel, which could break `process.env.ADMIN_SECRET` reads and full Node.js `fetch` semantics.

**Fix:** Added `export const runtime = 'nodejs'` after the imports.

---

### CRIT-3 — `/api/member/*` routes outside middleware protection perimeter

**File:** `middleware.ts`
**Root cause:** `MEMBER_PREFIXES` only contained `'/dashboard'`. The two new `/api/member/performance` and `/api/member/plan` routes were not gated by middleware. Both routes perform their own inline `supabase.auth.getUser()` checks (saving the current behavior), but any future `/api/member/*` route added without inline auth would be completely unprotected.

**Fix:** Added `'/api/member'` to `MEMBER_PREFIXES`. Middleware now enforces authentication for all `/api/member/*` routes before the route handler runs.

---

## Production Flow Verification

### Founder Login → Admin Dashboard

| Check | Result |
|-------|--------|
| `middleware.ts` ADMIN_PREFIXES covers `/admin`, `/api/admin`, `/api/scanner`, `/api/scheduler`, `/api/analytics` | ✅ Correct |
| Unauthenticated user → `/admin/*` redirected to `/login?next=...` | ✅ Correct |
| Non-admin authenticated user → 401 / redirect to login | ✅ Correct |
| Admin email allowlist (`ADMIN_EMAILS`) still gates admin access | ✅ Correct |
| Admin users blocked from `b69c987` dashboard changes? No cross-links | ✅ Correct |

### Scanner Flow

| Check | Result |
|-------|--------|
| `/api/scanner/run` still proxies to Python `${BACKEND_URL}/api/scanner/trigger` | ✅ Correct |
| Admin proxy (`/api/admin/[...path]`) still injects `X-Admin-Secret` | ✅ Correct |
| Admin proxy now has `runtime = 'nodejs'` | ✅ Fixed (CRIT-2) |

### Signal Pipeline → Database

| Check | Result |
|-------|--------|
| `computeLifecycleStage()` exports in `lib/signal-lifecycle.ts` unchanged | ✅ Correct |
| `getRecentSignals()` in `lib/supabase.ts` unchanged | ✅ Correct |
| `/api/signals/tactical` — plan-based confidence floor applied | ✅ Fixed (CRIT-1) |
| `/api/signals/counts` — unchanged, still DB-authoritative | ✅ Correct |

### Probability Engine → RiskGrade

| Check | Result |
|-------|--------|
| Python backend analytics routes unaffected (no Python files changed in `b69c987`) | ✅ Correct |
| `/api/admin/analytics/*` proxy unchanged | ✅ Correct |

### Analytics → Performance (Admin)

| Check | Result |
|-------|--------|
| All 6 analytics routes still under `/api/analytics` (gated by middleware) | ✅ Correct |
| Attribution, edge, calibration, monitor routes untouched | ✅ Correct |

### WhatsApp / Monitoring

| Check | Result |
|-------|--------|
| `telegram_notifier.py` unaffected — no Python changes in `b69c987` | ✅ Correct |
| `monitor` API route unchanged | ✅ Correct |

### Settings → Feature Flags → Health Center

| Check | Result |
|-------|--------|
| `/admin/system` page unchanged by `b69c987` | ✅ Correct |
| All 4 admin redirects in `next.config.mjs` still present | ✅ Correct |
| Feature flags, Quick Controls, Operating Mode all intact | ✅ Correct |

### Access Control

| Check | Result |
|-------|--------|
| `getAccessContext()` returns enterprise plan for admin emails | ✅ Correct |
| Enterprise plan: no confidence floor (70), no daily cap (-1) | ✅ Correct |
| `getUserPlan` export is additive only — existing callers unaffected | ✅ Correct |

---

## Medium Issues (not regressions — no fix applied)

| ID | File | Issue |
|----|------|-------|
| MED-1 | `app/dashboard/page.tsx:41` | Redundant null-user fallback (`user ? getUserPlan(...) : 'free'`) after middleware + layout already guard — dead code path, not harmful |
| MED-2 | `lib/supabase/server.ts:9` | `cookies()` called without `await` — latent bug for future callers; pre-existing, not introduced by `b69c987`. New dashboard code bypasses this file entirely (inline `createServerClient` calls). |

---

## Low Issues (not regressions — no fix applied)

| ID | File | Issue |
|----|------|-------|
| LOW-1 | `components/member/signals-feed.tsx` | Duplicates `timeAgo`/`fmtPrice` from `lib/member-utils.ts`; `fmtPrice` threshold differs slightly |
| LOW-2 | `app/dashboard/signals/active/page.tsx:8` | `VALIDATED` in `ACTIVE_STAGES` is unreachable dead code (per CLAUDE.md decision #47) |
| LOW-3 | `app/dashboard/performance/page.tsx` | Client-side fetch, no caching — acceptable for low-traffic current phase |
| LOW-4 | `app/dashboard/settings/page.tsx` | Two Supabase auth calls on mount (redundant but harmless) |
| LOW-5 | `types/index.ts:48` | `RiskGrade` type missing `'A+'` and `'B+'` — badge lookup falls to default grey for those grades |

---

## Files Changed by This Validation

| File | Change |
|------|--------|
| `app/api/signals/tactical/route.ts` | CRIT-1: `getAccessContext()` + `effectiveMinConf` |
| `app/api/admin/[...path]/route.ts` | CRIT-2: `export const runtime = 'nodejs'` |
| `middleware.ts` | CRIT-3: `'/api/member'` added to `MEMBER_PREFIXES` |

---

## Overall Result

**3 regressions fixed. Platform production-safe.**

The homepage and user dashboard work in `b69c987` did not break the admin trading platform, scanner, analytics, or health center. The regressions were all in the boundary between the new member-facing routes and existing platform routes — access control gaps that would have allowed free-tier users to see unrestricted signals and created a structural middleware gap for future API member routes.
