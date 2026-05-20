-- Admin authentication audit log
-- Run once against your Supabase project (SQL Editor or psql).
-- Records login, logout, login_failed, and unauthorized access events.

CREATE TABLE IF NOT EXISTS admin_auth_log (
    id         BIGSERIAL    PRIMARY KEY,
    event      TEXT         NOT NULL
                            CHECK (event IN ('login', 'logout', 'login_failed', 'unauthorized')),
    email      TEXT,
    ip         TEXT,
    user_agent TEXT,
    detail     TEXT,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookup by time (most recent events first)
CREATE INDEX IF NOT EXISTS idx_admin_auth_log_created
    ON admin_auth_log (created_at DESC);

-- Filter by event type (e.g. count failed logins)
CREATE INDEX IF NOT EXISTS idx_admin_auth_log_event
    ON admin_auth_log (event);

-- Row-level security: only the service role can write; no anon reads
ALTER TABLE admin_auth_log ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically — no policy needed for writes.
-- Block any accidental anon/authenticated reads:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'admin_auth_log' AND policyname = 'deny_public_read'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY deny_public_read ON admin_auth_log
        FOR SELECT USING (false)
    $policy$;
  END IF;
END $$;
