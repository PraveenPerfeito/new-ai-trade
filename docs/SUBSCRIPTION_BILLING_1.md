# SUBSCRIPTION.BILLING.1 — Razorpay Subscription Integration

**Date:** 2026-06-25  
**Status:** SPEC — ready to implement  
**Scope:** Full subscription billing: plan gating, Razorpay checkout, webhook lifecycle, WhatsApp alert delivery to subscribers  
**Zero change to signal generation, scanner, or admin paths**

---

## SECTION 1 — Plan Matrix

| Feature | FREE | PRO | PREMIUM |
|---------|------|-----|---------|
| Price (INR/month) | ₹0 | ₹999 | ₹2,499 |
| Price (USD/month) | $0 | $12 | $29 |
| Signal delay | **4 hours** | Real-time | Real-time |
| WhatsApp alerts | ✗ | ✓ | ✓ Priority |
| Scan modes | SPOT only | All modes | All modes |
| Daily signal limit | 5 visible | Unlimited | Unlimited |
| Confidence floor | ≥ 87 | ≥ 80 | ≥ 75 |
| Manual scan trigger | ✗ | ✓ (5/day) | ✓ Unlimited |
| API access | ✗ | 10K calls/month | Unlimited |
| Support | Community | Email (48h) | Priority (4h) |
| Razorpay plan ID | — | `plan_pro_monthly` | `plan_premium_monthly` |

**Signal delay mechanics for FREE:**  
Signals are visible only when `created_at < NOW() - INTERVAL '4 hours'`. Free users always see valid, resolved signals — just not actionable ones. Locked count shown in UI: "X new signals (unlock with PRO)".

**WhatsApp priority for PREMIUM:**  
PREMIUM users are queued before PRO users in the alert fanout loop. Delivery within first 30s of signal generation; PRO users follow immediately after.

---

## SECTION 2 — Architecture

### 2.1 Plan ID mapping

```
'free'      → FREE tier (existing code)
'pro'       → PRO tier  (existing code, reprice + redefine limits)
'premium'   → PREMIUM tier  (NEW — add to lib/plans.ts)
'enterprise' → admin bypass (KEEP — never exposed to public)
```

Add `'premium'` to `PlanId` type. Reprice existing `pro` to ₹999. `enterprise` remains the internal admin bypass (no Razorpay involvement).

### 2.2 Signal delay implementation

`filterSignalsForPlan()` in `lib/access-control.ts` gets a `signalDelayHours` gate:

```typescript
if (plan.signalDelayHours > 0) {
  const cutoff = Date.now() - plan.signalDelayHours * 3600 * 1000;
  const delayed  = signals.filter(s => new Date(s.createdAt).getTime() <= cutoff);
  const locked   = signals.filter(s => new Date(s.createdAt).getTime() >  cutoff);
  return { visible: delayed, lockedCount: locked.length };
}
```

`lib/plans.ts` adds `signalDelayHours: 4` to FREE, `0` to PRO/PREMIUM/enterprise.

### 2.3 WhatsApp alert fanout

Current delivery: single recipient from `WHATSAPP_PHONE` env var.  
New delivery: `telegram_notifier.py` iterates subscriber list after sending admin alert.

```
Admin alert (always first, unchanged)
 └── fanout_to_subscribers(signal)
      ├── PREMIUM users  (ordered by subscription_start ASC — earliest subscriber first)
      └── PRO users      (ordered by subscription_start ASC)
```

Subscriber list fetched from Supabase at scan start and cached in-process for 5 minutes (same pattern as settings cache). Zero extra Redis ops.

### 2.4 Razorpay flow

```
User clicks "Subscribe" (pricing page)
  → POST /api/razorpay/create-order  { planId: 'pro' | 'premium' }
  ← { subscriptionId, key }
  → Razorpay checkout modal opens (frontend SDK)
  → User pays
  → Razorpay calls POST /api/razorpay/webhook
  → Webhook verifies signature, updates users.plan_id + subscription_status
  → User redirected to /dashboard (plan now active)
```

Razorpay **Subscriptions** API (recurring billing) — not one-time Orders. Subscriptions auto-renew and send webhook events on each charge and on cancellation/failure.

---

## SECTION 3 — Database Changes

### 3.1 Alter `users` table

```sql
-- database/subscription-billing-migration.sql

-- Repurpose Stripe columns for Razorpay (rename via new columns, drop old)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS razorpay_customer_id      TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id  TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_phone            TEXT,     -- subscriber's own number
  ADD COLUMN IF NOT EXISTS whatsapp_alerts_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS subscription_start        TIMESTAMPTZ;

-- plan_id already exists as TEXT; add 'premium' to check constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_id_check;
ALTER TABLE users ADD CONSTRAINT users_plan_id_check
  CHECK (plan_id IN ('free', 'pro', 'premium', 'enterprise'));

-- subscription_status already exists; add razorpay states
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_subscription_status_check;
ALTER TABLE users ADD CONSTRAINT users_subscription_status_check
  CHECK (subscription_status IN (
    'none', 'active', 'trialing', 'past_due', 'canceled',
    'created', 'authenticated', 'halted', 'paused', 'expired', 'completed'
  ));
```

### 3.2 Add `razorpay_events` table (idempotency)

```sql
CREATE TABLE IF NOT EXISTS razorpay_events (
  id           TEXT PRIMARY KEY,   -- razorpay event id
  event        TEXT NOT NULL,      -- e.g. "subscription.charged"
  payload      JSONB NOT NULL,
  processed    BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.3 Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_users_razorpay_sub
  ON users (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_plan_whatsapp
  ON users (plan_id, whatsapp_phone)
  WHERE whatsapp_phone IS NOT NULL AND whatsapp_alerts_enabled = TRUE;
```

---

## SECTION 4 — Backend API Routes (Next.js)

### 4.1 `POST /api/razorpay/create-subscription`

```
Auth: Supabase session required
Body: { planId: 'pro' | 'premium' }
Returns: { subscriptionId: string, key: string }
```

Logic:
1. Resolve session → userId
2. Look up or create Razorpay customer (store in `users.razorpay_customer_id`)
3. Call Razorpay `POST /v1/subscriptions` with the plan's Razorpay `plan_id`
4. Store pending `razorpay_subscription_id` + `subscription_status = 'created'`
5. Return `{ subscriptionId, key: RAZORPAY_KEY_ID }`

```typescript
// app/api/razorpay/create-subscription/route.ts
import Razorpay from 'razorpay';
const rzp = new Razorpay({
  key_id:     getEnv('RAZORPAY_KEY_ID'),
  key_secret: getEnv('RAZORPAY_KEY_SECRET'),
});
```

### 4.2 `POST /api/razorpay/webhook`

```
Auth: Razorpay-Signature header verification (HMAC-SHA256)
Body: Razorpay webhook event JSON
Returns: 200 OK
```

**Events handled:**

| Event | Action |
|-------|--------|
| `subscription.authenticated` | Set `subscription_status='authenticated'` |
| `subscription.activated` | Set `plan_id`, `subscription_status='active'`, `subscription_start=NOW()` |
| `subscription.charged` | Extend `plan_expires_at` by 1 month; set `subscription_status='active'` |
| `subscription.halted` | Set `subscription_status='halted'`; downgrade `plan_id='free'` after 7-day grace |
| `subscription.cancelled` | Set `subscription_status='canceled'`; downgrade `plan_id='free'` at `plan_expires_at` |
| `subscription.completed` | Set `subscription_status='completed'`; downgrade `plan_id='free'` |
| `subscription.paused` | Set `subscription_status='paused'` |
| `subscription.resumed` | Set `subscription_status='active'` |

Idempotency: check `razorpay_events` table by event ID before processing. INSERT IGNORE pattern.

```typescript
// app/api/razorpay/webhook/route.ts
import crypto from 'crypto';

function verifyWebhookSignature(body: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', getEnv('RAZORPAY_WEBHOOK_SECRET'))
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

### 4.3 `GET /api/member/subscription`

```
Auth: Supabase session required
Returns: { planId, status, expiresAt, whatsappAlertsEnabled, whatsappPhone }
```

Used by `/dashboard/settings` billing section to show current plan state.

### 4.4 `POST /api/member/cancel-subscription`

```
Auth: Supabase session required
Body: { cancelAtPeriodEnd: boolean }
Action: Call Razorpay PATCH /v1/subscriptions/{id} with cancel_at_cycle_end=1
```

### 4.5 `PATCH /api/member/whatsapp-alerts`

```
Auth: Supabase session required
Body: { phone?: string, enabled?: boolean }
Validation: phone must match ^\+[1-9]\d{6,14}$ (E.164)
Action: Update users.whatsapp_phone + whatsapp_alerts_enabled
Restriction: Only PRO/PREMIUM plans; returns 403 for FREE
```

---

## SECTION 5 — Python Backend Changes

### 5.1 Subscriber list cache (`backend/core/subscribers.py`)

```python
# Module-level cache (5-min TTL, same pattern as settings cache)
_subscriber_cache: list[dict] | None = None
_subscriber_cache_at: float = 0.0
_SUBSCRIBER_TTL = 300  # seconds

async def get_active_subscribers(pool) -> list[dict]:
    """Returns PRO + PREMIUM users with whatsapp_phone set, ordered PREMIUM first."""
    global _subscriber_cache, _subscriber_cache_at
    if _subscriber_cache is not None and time.time() - _subscriber_cache_at < _SUBSCRIBER_TTL:
        return _subscriber_cache
    rows = await pool.fetch("""
        SELECT id, email, plan_id, whatsapp_phone, subscription_start
        FROM users
        WHERE plan_id IN ('pro', 'premium')
          AND subscription_status = 'active'
          AND whatsapp_phone IS NOT NULL
          AND whatsapp_alerts_enabled = TRUE
        ORDER BY
          CASE plan_id WHEN 'premium' THEN 0 ELSE 1 END,
          subscription_start ASC
    """)
    _subscriber_cache = [dict(r) for r in rows]
    _subscriber_cache_at = time.time()
    return _subscriber_cache
```

### 5.2 Alert fanout (`backend/core/scanner/telegram_notifier.py`)

After the existing admin alert send (unchanged), add:

```python
async def _fanout_to_subscribers(self, text: str) -> None:
    """Send signal alert to all active PRO/PREMIUM subscribers."""
    # IMPORTANT: Do NOT gate on _ops_alerts_enabled() here — that flag defaults
    # to False and controls ops/system alerts, not subscriber signal alerts.
    # send_signal_alert() is already gated on telegram.alerts_enabled before
    # calling this function, so no additional gate is needed.
    subscribers = await get_active_subscribers(self._pool)
    if not subscribers:
        return
    settings = get_settings()
    async with httpx.AsyncClient(timeout=5.0) as client:
        for sub in subscribers:
            try:
                await client.post(
                    f"{settings.whatsapp_api_url.rstrip('/')}/messages/chat",
                    json={
                        "token": settings.whatsapp_token,
                        "to":    sub["whatsapp_phone"],
                        "body":  text,
                    },
                )
            except Exception:
                log.warning("subscriber_alert_failed", user_id=str(sub["id"]))
```

`_fanout_to_subscribers` is called from `send_signal_alert()` after the admin send, wrapped in `asyncio.create_task()` so it does not block signal processing.

### 5.3 No changes to scanner, signal pipeline, or gating logic

Subscriber delivery is purely additive. The Supabase `pool` reference is passed in from `scan_task.py` (already available via `get_pool()`).

---

## SECTION 6 — Frontend Changes

### 6.1 `lib/plans.ts` — update plan definitions

```typescript
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthlyInr: 0,
    priceMonthlyUsd: 0,
    signalDelayHours: 4,          // NEW
    minSignalConfidence: 87,
    dailySignalLimit: 5,
    monthlyApiCalls: 0,
    maxScanTriggers: 0,
    allowedModes: ['spot'],
    features: ['Delayed signals (4h)', 'SPOT mode', 'Confidence ≥87%'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthlyInr: 999,
    priceMonthlyUsd: 12,
    signalDelayHours: 0,          // real-time
    minSignalConfidence: 80,
    dailySignalLimit: -1,
    monthlyApiCalls: 10000,
    maxScanTriggers: 5,
    allowedModes: ['spot', 'futures', 'trending'],
    features: ['Real-time signals', 'WhatsApp alerts', 'All scan modes', 'Confidence ≥80%', 'Email support (48h)'],
  },
  premium: {                       // NEW
    id: 'premium',
    name: 'Premium',
    priceMonthlyInr: 2499,
    priceMonthlyUsd: 29,
    signalDelayHours: 0,
    minSignalConfidence: 75,
    dailySignalLimit: -1,
    monthlyApiCalls: -1,
    maxScanTriggers: -1,
    allowedModes: ['spot', 'futures', 'trending'],
    features: ['Everything in Pro', 'Priority WhatsApp delivery', 'Unlimited API', 'Priority support (4h)'],
  },
  enterprise: {                    // admin bypass — unchanged, not shown publicly
    id: 'enterprise',
    name: 'Enterprise',
    priceMonthlyInr: 0,
    priceMonthlyUsd: 0,
    signalDelayHours: 0,
    minSignalConfidence: 0,
    dailySignalLimit: -1,
    monthlyApiCalls: -1,
    maxScanTriggers: -1,
    allowedModes: ['spot', 'futures', 'trending', 'high_confidence'],
    features: [],
  },
};
```

### 6.2 `app/pricing/page.tsx` — replace Telegram CTAs with Razorpay checkout

Replace:
```tsx
<a href="https://t.me/signaledgeai">Get Started</a>
```

With:
```tsx
<SubscribeButton planId="pro" />
<SubscribeButton planId="premium" />
```

`SubscribeButton` component (`components/subscribe-button.tsx`):
1. On click → `POST /api/razorpay/create-subscription` → `{ subscriptionId, key }`
2. Load Razorpay checkout script (inline script tag, not CDN — CSP safe)
3. Open `new Razorpay({ key, subscription_id: subscriptionId, ... }).open()`
4. On `payment.success` → redirect to `/dashboard?subscribed=1`
5. Show loading/error states

```typescript
// components/subscribe-button.tsx
'use client';
declare global { interface Window { Razorpay: any } }

export function SubscribeButton({ planId }: { planId: 'pro' | 'premium' }) {
  const [loading, setLoading] = useState(false);

  async function handleSubscribe() {
    setLoading(true);
    const res = await fetch('/api/razorpay/create-subscription', {
      method: 'POST',
      body: JSON.stringify({ planId }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      setLoading(false);
      throw new Error(`Subscription creation failed: ${res.status}`);
    }
    const { subscriptionId, key } = await res.json();

    // Lazily load Razorpay SDK (not CDN — inject inline to stay CSP-safe)
    await loadRazorpayScript();

    const rzp = new window.Razorpay({
      key,
      subscription_id: subscriptionId,
      name: 'SignalEdge AI',
      description: `${planId === 'pro' ? 'Pro' : 'Premium'} Plan`,
      theme: { color: '#22d3ee' },
      handler: () => { window.location.href = '/dashboard?subscribed=1'; },
    });
    rzp.open();
    setLoading(false);
  }

  return (
    <button onClick={handleSubscribe} disabled={loading}>
      {loading ? 'Loading...' : 'Subscribe'}
    </button>
  );
}
```

### 6.3 `/dashboard/settings` — billing section

Add a "Billing" tab to the existing settings page:

```
Current Plan:    PRO  [Active]  Renews Dec 26, 2026
WhatsApp alerts: [+91 98765 43210]  [Toggle ON/OFF]
                 [Change number]
                 
[Cancel subscription]  →  confirms via modal, calls /api/member/cancel-subscription
```

---

## SECTION 7 — Razorpay Setup Steps

### 7.1 Create plans in Razorpay dashboard

Log in at `dashboard.razorpay.com` → Subscriptions → Plans → Create Plan:

| Field | PRO | PREMIUM |
|-------|-----|---------|
| Name | SignalEdge PRO | SignalEdge PREMIUM |
| Billing Amount | 99900 paise (₹999) | 249900 paise (₹2499) |
| Billing Interval | 1 | 1 |
| Period | monthly | monthly |
| Notes → plan_key | `pro` | `premium` |

Copy the generated `plan_id` (e.g. `plan_XXXXXXXXXXXXXXXX`) for each.

### 7.2 Create webhook endpoint

Razorpay dashboard → Webhooks → Add webhook:
- URL: `https://your-vercel-app.vercel.app/api/razorpay/webhook`
- Events to subscribe:
  - `subscription.authenticated`
  - `subscription.activated`
  - `subscription.charged`
  - `subscription.halted`
  - `subscription.cancelled`
  - `subscription.completed`
  - `subscription.paused`
  - `subscription.resumed`
- Copy the webhook secret → `RAZORPAY_WEBHOOK_SECRET`

### 7.3 Environment variables

**Vercel (Next.js) — add:**
```
RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=<secret>
RAZORPAY_WEBHOOK_SECRET=<webhook secret>
RAZORPAY_PLAN_ID_PRO=plan_XXXXXXXXXXXXXXXX
RAZORPAY_PLAN_ID_PREMIUM=plan_XXXXXXXXXXXXXXXX
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXXXXXX  # exposed to client for checkout modal
```

**Railway (Python backend) — no changes needed** (subscriber fanout reads from Supabase, not Razorpay directly).

### 7.4 Install Razorpay Node SDK

```bash
npm install razorpay
```

Add to `package.json` dependencies. No backend Python SDK needed.

### 7.5 CSP configuration — `next.config.mjs`

The Razorpay checkout modal loads `checkout.razorpay.com/v1/checkout.js`. If a `Content-Security-Policy` header is set, add `checkout.razorpay.com` to `script-src` and `frame-src`:

```js
// next.config.mjs — in headers() or security headers middleware
"script-src 'self' 'unsafe-inline' checkout.razorpay.com",
"frame-src 'self' checkout.razorpay.com api.razorpay.com",
```

Without this, the checkout modal will be blocked by CSP on browsers that enforce it.

---

## SECTION 8 — Access Control Changes

### 8.1 `lib/access-control.ts` — add delay gate

```typescript
// In filterSignalsForPlan():
const delayHours = plan.signalDelayHours ?? 0;
if (delayHours > 0) {
  const cutoffMs = Date.now() - delayHours * 3600 * 1000;
  const delayed = signals.filter(s => new Date(s.createdAt).getTime() <= cutoffMs);
  const locked  = signals.filter(s => new Date(s.createdAt).getTime() >  cutoffMs);
  return { visible: delayed.slice(0, plan.dailySignalLimit === -1 ? undefined : plan.dailySignalLimit), lockedCount: locked.length };
}
// else existing confidence + daily limit logic
```

### 8.2 `middleware.ts` — protect `/dashboard` routes

Already has `MEMBER_PREFIXES = ['/dashboard']`. Ensure unauthenticated users hitting `/dashboard` are redirected to `/login`. Confirm `/dashboard` is NOT in `ADMIN_PREFIXES`.

### 8.3 Plan activation grace period

Webhook sets `plan_id` immediately on `subscription.activated`. If webhook is delayed (Razorpay guarantees delivery within 60s), user may land on `/dashboard` before plan is upgraded.

**Solution:** On `/dashboard?subscribed=1`, poll `GET /api/member/subscription` every 3s for up to 30s until `status === 'active'`, then show success banner. Fallback: show "Activating your plan… (up to 30s)" spinner.

---

## SECTION 9 — Signal Delay UX

### What free users see

```
Active Signals                                    [Upgrade to PRO]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  BTC/USDT   BUY   87    +2.1%   [5h ago]   STALE
  ETH/USDT   SELL  89    +1.8%   [6h ago]   STALE
  ─────────────────────────────────────────────
  🔒 3 new signals available — real-time with PRO
```

- Signals shown are real (past entries, now resolved or stale)
- "3 new signals" count is accurate — creates urgency without spoiling content
- Clicking "Upgrade to PRO" → `/pricing`

### API response shape (`/api/signals`)

```json
{
  "success": true,
  "signals": [...],      // delayed/filtered signals
  "lockedCount": 3,      // new signals not visible yet
  "delayHours": 4,       // shown to user
  "plan": "free"
}
```

---

## SECTION 10 — Migration Plan

### Step 1 — DB migration (5 min)
Run `database/subscription-billing-migration.sql` in Supabase SQL Editor.

### Step 2 — Razorpay setup (10 min)
Create 2 plans + 1 webhook in Razorpay dashboard. Capture IDs.

### Step 3 — Deploy backend (Next.js)
- Add env vars to Vercel
- Deploy new API routes: `create-subscription`, `webhook`, `member/subscription`, `member/cancel-subscription`, `member/whatsapp-alerts`

### Step 4 — Deploy frontend
- Updated `lib/plans.ts` (add `premium`, add `signalDelayHours`)
- Updated `lib/access-control.ts` (delay gate)
- Updated `app/pricing/page.tsx` (Razorpay CTAs)
- New `components/subscribe-button.tsx`
- Updated `/dashboard/settings` billing tab

### Step 5 — Deploy Python backend
- New `backend/core/subscribers.py`
- Updated `telegram_notifier.py` (fanout)

### Step 6 — Smoke test (checklist below)

---

## SECTION 11 — Test Checklist

### FREE plan behaviour
- [ ] Signal list shows signals ≥ 4h old only
- [ ] `lockedCount` > 0 when signals generated in last 4h
- [ ] Confidence floor ≥ 87 applied
- [ ] Daily limit of 5 enforced
- [ ] WhatsApp alerts toggle disabled (403 on PATCH /api/member/whatsapp-alerts)
- [ ] "Upgrade" CTA visible in dashboard

### Razorpay checkout flow
- [ ] `POST /api/razorpay/create-subscription` returns `subscriptionId` + `key`
- [ ] Razorpay modal opens on button click
- [ ] Test mode payment completes (use test card `4111 1111 1111 1111`)
- [ ] `subscription.activated` webhook fires and updates DB `plan_id='pro'`
- [ ] User lands on `/dashboard?subscribed=1`; plan shown as PRO within 30s

### PRO plan behaviour
- [ ] Real-time signals (no delay)
- [ ] WhatsApp phone can be set via `/dashboard/settings`
- [ ] Alert fanout includes this number on next scan cycle
- [ ] Alert received on WhatsApp within 60s of signal generation
- [ ] Confidence floor ≥ 80 applied
- [ ] All scan modes visible (spot, futures, trending)

### PREMIUM plan behaviour
- [ ] Same as PRO plus
- [ ] Alert delivered BEFORE PRO users (verify order in logs)
- [ ] `maxScanTriggers = -1` (unlimited manual scans)
- [ ] API calls unlimited

### Webhook idempotency
- [ ] Send `subscription.charged` twice with same event ID → second is no-op
- [ ] `subscription.halted` → `plan_id` stays as-is, `subscription_status='halted'`
- [ ] After 7-day grace window passes → `plan_id='free'` downgrade (manual test or cron)

### Cancellation
- [ ] `POST /api/member/cancel-subscription` with `cancelAtPeriodEnd=true` → Razorpay subscription marked cancelled at cycle end
- [ ] User remains on PRO until `plan_expires_at`
- [ ] On `subscription.completed` webhook → `plan_id='free'`

---

## SECTION 12 — Open Items

| ID | Item | Priority |
|----|------|----------|
| OI-1 | Grace period downgrade: need a Celery beat task (`check_expired_subscriptions`) that runs every 6h and sets `plan_id='free'` where `subscription_status IN ('halted','canceled','completed') AND plan_expires_at < NOW()` | P1 |
| OI-2 | Razorpay does not natively support INR → USD conversion on dashboard — consider showing INR only, add USD as "(approx $X)" label | P2 |
| OI-3 | WhatsApp alert fanout adds latency on the Python side — use `asyncio.create_task()` to fire-and-forget so scan cycle is not blocked | P0 (in spec — verify in implementation) |
| OI-4 | Free user "locked signals" count should not reveal signal symbols (privacy/fairness) — `lockedCount` only, no tickers | P1 |
| OI-5 | Consider annual billing option (2 months free) as future Phase — out of scope for BILLING.1 | P3 |
| OI-6 | UltraMsg has no batch-send API — fanout is sequential HTTP calls. With 100+ subscribers, this could take several seconds. Throttle to max 10 concurrent with `asyncio.Semaphore(10)` | P1 |

---

## SECTION 13 — Files to Create / Modify

### New files
| File | Description |
|------|-------------|
| `database/subscription-billing-migration.sql` | DB schema changes |
| `app/api/razorpay/create-subscription/route.ts` | Razorpay subscription creation |
| `app/api/razorpay/webhook/route.ts` | Webhook handler |
| `app/api/member/subscription/route.ts` | GET current subscription state |
| `app/api/member/cancel-subscription/route.ts` | Cancel subscription |
| `app/api/member/whatsapp-alerts/route.ts` | Update WhatsApp phone/toggle |
| `components/subscribe-button.tsx` | Razorpay checkout modal trigger |
| `backend/core/subscribers.py` | Subscriber list cache (Python) |

### Modified files
| File | Change |
|------|--------|
| `lib/plans.ts` | Add `premium` tier; add `signalDelayHours`; reprice PRO |
| `lib/access-control.ts` | Signal delay gate in `filterSignalsForPlan()` |
| `types/index.ts` | Add `'premium'` to `PlanId`; add `signalDelayHours` to `Plan` |
| `app/pricing/page.tsx` | Replace Telegram CTAs with `<SubscribeButton>` |
| `app/dashboard/settings/page.tsx` | Add billing tab (current plan, cancel, WhatsApp) |
| `backend/core/scanner/telegram_notifier.py` | Add `_fanout_to_subscribers()` |

---

*Estimated implementation: 2–3 days solo.*  
*No scanner changes. No DB signal changes. No admin path changes.*
