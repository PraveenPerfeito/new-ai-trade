-- ============================================================
-- Monetisation schema — run AFTER schema.sql
-- ============================================================

-- Users (mirrors Supabase Auth users; planId, Stripe refs)
CREATE TABLE IF NOT EXISTS users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  TEXT NOT NULL UNIQUE,
  plan_id                TEXT NOT NULL DEFAULT 'free' CHECK (plan_id IN ('free', 'pro', 'enterprise')),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  subscription_status    TEXT NOT NULL DEFAULT 'none'
                           CHECK (subscription_status IN ('active', 'trialing', 'past_due', 'canceled', 'none')),
  plan_expires_at        TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx             ON users (email);
CREATE INDEX IF NOT EXISTS users_stripe_customer_idx   ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- API keys (hashed; raw key shown once at creation)
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,          -- first 8 chars, safe to show
  name         TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS api_keys_user_idx  ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx  ON api_keys (key_hash);

-- Monthly usage per user (upsert-increment pattern)
CREATE TABLE IF NOT EXISTS usage_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  period          TEXT NOT NULL,        -- "YYYY-MM"
  api_calls       INTEGER NOT NULL DEFAULT 0,
  signals_viewed  INTEGER NOT NULL DEFAULT 0,
  scans_triggered INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, period)
);

CREATE INDEX IF NOT EXISTS usage_records_user_period_idx ON usage_records (user_id, period);

-- Stripe webhook events (idempotency; no double-processing)
CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,          -- Stripe event ID (evt_xxx)
  type        TEXT NOT NULL,
  processed   BOOLEAN NOT NULL DEFAULT FALSE,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS stripe_events_type_idx ON stripe_events (type);

-- Row-level security (enable after confirming service-role key is used server-side)
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- Service-role bypasses RLS; anon/authenticated roles are locked out by default.
-- Add granular policies here if you expose these tables to the browser.
