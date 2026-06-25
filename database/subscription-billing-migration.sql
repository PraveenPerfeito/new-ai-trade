-- ============================================================
-- SUBSCRIPTION.BILLING.1 — Razorpay subscription billing
-- Run in Supabase SQL Editor AFTER monetization-schema.sql
-- Idempotent: safe to re-run
-- ============================================================

BEGIN;

-- ── 1. Add Razorpay + subscriber columns to users ────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS razorpay_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_phone           TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_alerts_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS subscription_start       TIMESTAMPTZ;

-- ── 2. Extend plan_id check — add 'premium' tier ─────────────────────────────

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_id_check;
ALTER TABLE users ADD CONSTRAINT users_plan_id_check
  CHECK (plan_id IN ('free', 'pro', 'premium', 'enterprise'));

-- ── 3. Extend subscription_status — add Razorpay lifecycle states ────────────
--   Razorpay states: created → authenticated → active
--                   active  → halted | paused | cancelled | completed
--   Existing Stripe states kept for backwards compat: trialing, past_due

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_subscription_status_check;
ALTER TABLE users ADD CONSTRAINT users_subscription_status_check
  CHECK (subscription_status IN (
    -- existing
    'none', 'active', 'trialing', 'past_due', 'canceled',
    -- Razorpay-specific
    'created', 'authenticated', 'halted', 'paused', 'expired', 'completed'
  ));

-- ── 4. Drop unused Stripe columns (only if they were never written to) ────────

DO $$
BEGIN
  -- stripe_customer_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'users'
      AND column_name  = 'stripe_customer_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM users WHERE stripe_customer_id IS NOT NULL LIMIT 1
  ) THEN
    ALTER TABLE users DROP COLUMN stripe_customer_id;
  END IF;

  -- stripe_subscription_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'users'
      AND column_name  = 'stripe_subscription_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM users WHERE stripe_subscription_id IS NOT NULL LIMIT 1
  ) THEN
    ALTER TABLE users DROP COLUMN stripe_subscription_id;
  END IF;
END $$;

-- ── 5. razorpay_events table (idempotency — prevents double-processing) ───────

CREATE TABLE IF NOT EXISTS razorpay_events (
  id           TEXT        PRIMARY KEY,          -- Razorpay event ID
  event        TEXT        NOT NULL,             -- e.g. 'subscription.charged'
  payload      JSONB       NOT NULL,
  processed    BOOLEAN     NOT NULL DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE razorpay_events ENABLE ROW LEVEL SECURITY;

-- ── 6. Indexes ────────────────────────────────────────────────────────────────

-- Remove old Stripe index (replaced below)
DROP INDEX IF EXISTS users_stripe_customer_idx;

-- Razorpay lookups from webhook handler
CREATE INDEX IF NOT EXISTS idx_users_razorpay_customer
  ON users (razorpay_customer_id)
  WHERE razorpay_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_razorpay_subscription
  ON users (razorpay_subscription_id)
  WHERE razorpay_subscription_id IS NOT NULL;

-- Subscriber fanout query (Python backend, runs every 5 min):
--   WHERE plan_id IN ('pro','premium')
--     AND subscription_status = 'active'
--     AND whatsapp_phone IS NOT NULL
--     AND whatsapp_alerts_enabled = TRUE
CREATE INDEX IF NOT EXISTS idx_users_subscriber_fanout
  ON users (plan_id, subscription_status)
  WHERE whatsapp_phone IS NOT NULL
    AND whatsapp_alerts_enabled = TRUE;

-- razorpay_events event-type lookup
CREATE INDEX IF NOT EXISTS idx_razorpay_events_event
  ON razorpay_events (event, created_at DESC);

COMMIT;

-- ── Verification query (run separately to confirm) ────────────────────────────
/*
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'users'
ORDER BY ordinal_position;

SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('users', 'razorpay_events')
ORDER BY tablename, indexname;
*/
