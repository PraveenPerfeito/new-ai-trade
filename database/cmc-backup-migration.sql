-- ============================================================
-- CMC.DATA.BACKUP.1 + CMC.REMOVAL.IMPLEMENTATION.1
-- Local tables for coin metadata, sector membership, and
-- discovery history — serve as Postgres fallback when Redis
-- cache is cold and external APIs are unavailable.
--
-- Run in Supabase SQL Editor before CMC Startup plan expires.
-- All statements are idempotent (IF NOT EXISTS / ON CONFLICT).
-- ============================================================

-- ── Table 1: cmc_sectors ──────────────────────────────────────────────────────
-- Full sector/category records captured from CMC /cryptocurrency/categories.
-- coins[] is the critical backup: CMC returns the full list; CoinGecko only
-- returns top_3_coins image URLs (not symbols). Once Startup expires, coins[]
-- is only refreshed weekly via CoinGecko partial append (never overwritten).

CREATE TABLE IF NOT EXISTS cmc_sectors (
    id                     SERIAL PRIMARY KEY,
    category_id            TEXT        NOT NULL UNIQUE,
    name                   TEXT        NOT NULL,
    title                  TEXT,
    market_cap             NUMERIC(22, 2),
    market_cap_change_24h  NUMERIC(10, 4),
    avg_price_change       NUMERIC(10, 4),
    coin_count             INT         NOT NULL DEFAULT 0,
    coins                  TEXT[]      NOT NULL DEFAULT '{}',
    refreshed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    source                 TEXT        NOT NULL DEFAULT 'cmc'
);

CREATE INDEX IF NOT EXISTS idx_cmc_sectors_refreshed ON cmc_sectors (refreshed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmc_sectors_name      ON cmc_sectors (name);

-- ── Table 2: coin_sector_assignments ─────────────────────────────────────────
-- Normalized coin → sector rows for O(1) lookup by symbol.
-- Populated from cmc_sectors.coins[] at capture time.
-- Read by intelligence_cache._fallback_db_sectors() to build sector maps.

CREATE TABLE IF NOT EXISTS coin_sector_assignments (
    symbol       TEXT        NOT NULL,
    category_id  TEXT        NOT NULL,
    sector_name  TEXT        NOT NULL,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    source       TEXT        NOT NULL DEFAULT 'cmc',
    PRIMARY KEY (symbol, category_id)
);

CREATE INDEX IF NOT EXISTS idx_csa_symbol ON coin_sector_assignments (symbol);
CREATE INDEX IF NOT EXISTS idx_csa_cat    ON coin_sector_assignments (category_id);

-- ── Table 3: symbol_mappings ──────────────────────────────────────────────────
-- Canonical cross-service identity: CMC ID ↔ Binance pair ↔ CoinGecko ID.
-- Populated once from CMC /listings/latest; updated rarely.
-- Supersedes hardcoded COINGECKO_TO_BINANCE map in lib/market-data/binance-symbols.ts.

CREATE TABLE IF NOT EXISTS symbol_mappings (
    symbol             TEXT PRIMARY KEY,
    cmc_id             INT,
    cmc_slug           TEXT,
    binance_spot       TEXT,
    binance_futures    TEXT,
    coingecko_id       TEXT,
    is_stablecoin      BOOLEAN     NOT NULL DEFAULT false,
    is_active          BOOLEAN     NOT NULL DEFAULT true,
    last_verified_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sm_cmc_id       ON symbol_mappings (cmc_id);
CREATE INDEX IF NOT EXISTS idx_sm_cg_id        ON symbol_mappings (coingecko_id);
CREATE INDEX IF NOT EXISTS idx_sm_binance_spot ON symbol_mappings (binance_spot);
CREATE INDEX IF NOT EXISTS idx_sm_active       ON symbol_mappings (is_active) WHERE is_active = true;

-- ── Table 4: coin_rankings_history ────────────────────────────────────────────
-- Daily rank + mcap tier snapshots. 90-day retention enforced by nightly Celery task.
-- Source after CMC Free cutover: Redis cache:intel:listings (already populated
-- every 15 min by TypeScript workers from CMC Free /listings/latest).

CREATE TABLE IF NOT EXISTS coin_rankings_history (
    id               BIGSERIAL PRIMARY KEY,
    symbol           TEXT        NOT NULL,
    cmc_rank         INT,
    market_cap       NUMERIC(22, 2),
    volume_24h       NUMERIC(22, 2),
    price_change_24h NUMERIC(8, 4),
    mcap_tier        TEXT,
    snapshot_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
    source           TEXT        NOT NULL DEFAULT 'cmc'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crh_uq     ON coin_rankings_history (symbol, snapshot_date);
CREATE INDEX        IF NOT EXISTS idx_crh_date   ON coin_rankings_history (snapshot_date DESC);
CREATE INDEX        IF NOT EXISTS idx_crh_symbol ON coin_rankings_history (symbol);

-- ── Enable RLS (same pattern as existing tables) ─────────────────────────────
ALTER TABLE cmc_sectors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_sector_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE symbol_mappings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_rankings_history  ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (Celery backend uses SERVICE_ROLE_KEY)
DROP POLICY IF EXISTS "service_all_cmc_sectors"    ON cmc_sectors;
DROP POLICY IF EXISTS "service_all_csa"            ON coin_sector_assignments;
DROP POLICY IF EXISTS "service_all_symbol_mappings" ON symbol_mappings;
DROP POLICY IF EXISTS "service_all_rankings_hist"  ON coin_rankings_history;

CREATE POLICY "service_all_cmc_sectors"
    ON cmc_sectors FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_csa"
    ON coin_sector_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_symbol_mappings"
    ON symbol_mappings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_rankings_hist"
    ON coin_rankings_history FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon reads (dashboard telemetry)
DROP POLICY IF EXISTS "anon_read_cmc_sectors"    ON cmc_sectors;
DROP POLICY IF EXISTS "anon_read_symbol_mappings" ON symbol_mappings;

CREATE POLICY "anon_read_cmc_sectors"
    ON cmc_sectors FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_symbol_mappings"
    ON symbol_mappings FOR SELECT TO anon USING (true);
