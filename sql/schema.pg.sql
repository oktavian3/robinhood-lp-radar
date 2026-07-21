-- Robinhood LP Radar — PostgreSQL Schema
-- No TimescaleDB dependency. Uses regular tables + indexes.

-- 1. Blocks
CREATE TABLE IF NOT EXISTS chain_blocks (
  chain_id INTEGER NOT NULL DEFAULT 4663,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT TRUE,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, block_number)
);
CREATE INDEX IF NOT EXISTS idx_blocks_time ON chain_blocks(block_time DESC);
CREATE INDEX IF NOT EXISTS idx_blocks_canonical ON chain_blocks(chain_id, canonical, block_number DESC);

-- 2. Tokens
CREATE TABLE IF NOT EXISTS tokens (
  chain_id INTEGER NOT NULL DEFAULT 4663,
  address TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  decimals INTEGER,
  token_type TEXT NOT NULL DEFAULT 'erc20',
  is_stock_token BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_allowlisted BOOLEAN NOT NULL DEFAULT FALSE,
  is_blocklisted BOOLEAN NOT NULL DEFAULT FALSE,
  contract_code_hash TEXT,
  ui_multiplier NUMERIC,
  oracle_paused BOOLEAN,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, address)
);

-- 3. Pools
CREATE TABLE IF NOT EXISTS pools (
  id BIGSERIAL PRIMARY KEY,
  chain_id INTEGER NOT NULL DEFAULT 4663,
  protocol TEXT NOT NULL CHECK (protocol IN ('v2','v3','v4')),
  pool_address TEXT,
  pool_id TEXT,
  token0 TEXT NOT NULL,
  token1 TEXT NOT NULL,
  fee INTEGER,
  tick_spacing INTEGER,
  hooks TEXT,
  factory_or_manager TEXT NOT NULL,
  created_block BIGINT,
  created_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'discovered',
  rejection_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pools_unique ON pools(chain_id, protocol, COALESCE(pool_address,''), COALESCE(pool_id,''));
CREATE INDEX IF NOT EXISTS idx_pools_tokens ON pools(chain_id, token0, token1);
CREATE INDEX IF NOT EXISTS idx_pools_status ON pools(status);
CREATE INDEX IF NOT EXISTS idx_pools_protocol ON pools(protocol);

-- 4. Raw events (idempotent by chain_id, tx_hash, log_index)
CREATE TABLE IF NOT EXISTS raw_events (
  chain_id INTEGER NOT NULL DEFAULT 4663,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  event_name TEXT NOT NULL,
  pool_ref TEXT,
  event_time TIMESTAMPTZ NOT NULL,
  decoded JSONB NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_events_pool_time ON raw_events(pool_ref, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_events_block ON raw_events(chain_id, block_number);
CREATE INDEX IF NOT EXISTS idx_events_name ON raw_events(event_name);

-- 5. Pool snapshots
CREATE TABLE IF NOT EXISTS pool_snapshots (
  id BIGSERIAL PRIMARY KEY,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pool_db_id BIGINT NOT NULL REFERENCES pools(id),
  source TEXT NOT NULL DEFAULT 'rpc',
  block_number BIGINT,
  price_token1_per_token0 NUMERIC,
  price_usd NUMERIC,
  reference_price_usd NUMERIC,
  reference_updated_at TIMESTAMPTZ,
  current_tick INTEGER,
  sqrt_price_x96 NUMERIC,
  active_liquidity NUMERIC,
  tvl_usd NUMERIC,
  volume_1h_usd NUMERIC,
  volume_24h_usd NUMERIC,
  volume_7d_usd NUMERIC,
  swaps_24h INTEGER,
  unique_traders_24h INTEGER,
  fee_apr_gross NUMERIC,
  external_price_deviation_pct NUMERIC,
  data_confidence NUMERIC,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_snapshots_pool_time ON pool_snapshots(pool_db_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_time ON pool_snapshots(time DESC);

-- 6. Candles (5m)
CREATE TABLE IF NOT EXISTS candles_5m (
  bucket TIMESTAMPTZ NOT NULL,
  pool_db_id BIGINT NOT NULL REFERENCES pools(id),
  source TEXT NOT NULL DEFAULT 'indexer',
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  base_volume NUMERIC,
  quote_volume NUMERIC,
  volume_usd NUMERIC,
  trade_count INTEGER,
  unique_traders INTEGER,
  is_backfilled BOOLEAN NOT NULL DEFAULT FALSE,
  coverage_ratio NUMERIC,
  PRIMARY KEY (bucket, pool_db_id, source)
);
CREATE INDEX IF NOT EXISTS idx_candles_pool ON candles_5m(pool_db_id, bucket DESC);

-- 7. Tick liquidity
CREATE TABLE IF NOT EXISTS tick_liquidity (
  id BIGSERIAL PRIMARY KEY,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pool_db_id BIGINT NOT NULL REFERENCES pools(id),
  tick INTEGER NOT NULL,
  liquidity_net NUMERIC,
  liquidity_gross NUMERIC,
  source TEXT NOT NULL DEFAULT 'rpc'
);
CREATE INDEX IF NOT EXISTS idx_ticks_pool_time ON tick_liquidity(pool_db_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_ticks_pool_tick ON tick_liquidity(pool_db_id, tick);

-- 8. Oracle snapshots
CREATE TABLE IF NOT EXISTS oracle_snapshots (
  id BIGSERIAL PRIMARY KEY,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_address TEXT NOT NULL,
  feed_address TEXT,
  answer NUMERIC,
  decimals INTEGER,
  updated_at TIMESTAMPTZ,
  heartbeat_seconds INTEGER,
  sequencer_up BOOLEAN,
  oracle_paused BOOLEAN,
  ui_multiplier NUMERIC,
  is_valid BOOLEAN NOT NULL DEFAULT TRUE,
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_oracle_token_time ON oracle_snapshots(token_address, time DESC);

-- 9. Recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  pool_db_id BIGINT NOT NULL REFERENCES pools(id),
  strategy TEXT NOT NULL,
  score NUMERIC NOT NULL,
  confidence NUMERIC NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'medium',
  current_price NUMERIC NOT NULL,
  lower_price NUMERIC NOT NULL,
  upper_price NUMERIC NOT NULL,
  tick_lower INTEGER,
  tick_upper INTEGER,
  deposit_asset TEXT NOT NULL,
  deposit_ratio JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_duration_hours_low NUMERIC,
  target_duration_hours_high NUMERIC,
  probability_12h NUMERIC,
  probability_24h NUMERIC,
  probability_3d NUMERIC,
  probability_7d NUMERIC,
  median_time_to_exit_hours NUMERIC,
  estimated_gross_fees_usd NUMERIC,
  estimated_il_usd NUMERIC,
  estimated_gas_usd NUMERIC,
  estimated_net_result_usd NUMERIC,
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_timestamps JSONB NOT NULL DEFAULT '{}'::jsonb,
  immutable_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_recommendations_created ON recommendations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_pool ON recommendations(pool_db_id);

-- 10. Recommendation rankings
CREATE TABLE IF NOT EXISTS recommendation_rankings (
  id BIGSERIAL PRIMARY KEY,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recommendation_id UUID NOT NULL REFERENCES recommendations(id),
  rank INTEGER NOT NULL,
  score NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS idx_rankings_time ON recommendation_rankings(time DESC);
CREATE INDEX IF NOT EXISTS idx_rankings_rec ON recommendation_rankings(recommendation_id);

-- 11. Paper positions
CREATE TABLE IF NOT EXISTS paper_positions (
  id UUID PRIMARY KEY,
  recommendation_id UUID NOT NULL REFERENCES recommendations(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  initial_capital_usd NUMERIC NOT NULL,
  initial_token0 NUMERIC,
  initial_token1 NUMERIC,
  status TEXT NOT NULL DEFAULT 'active',
  rebalance_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- 12. Position snapshots
CREATE TABLE IF NOT EXISTS position_snapshots (
  id BIGSERIAL PRIMARY KEY,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paper_position_id UUID NOT NULL REFERENCES paper_positions(id),
  token0_amount NUMERIC,
  token1_amount NUMERIC,
  position_value_usd NUMERIC,
  hold_value_usd NUMERIC,
  accrued_fees_usd NUMERIC,
  impermanent_loss_usd NUMERIC,
  gas_cost_usd NUMERIC,
  net_pnl_usd NUMERIC,
  in_range BOOLEAN,
  boundary_distance_pct NUMERIC,
  current_tick INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pos_snap_time ON position_snapshots(paper_position_id, time DESC);

-- 13. Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_alerts_entity ON alerts(entity_type, entity_id, created_at DESC);

-- 14. Data source health
CREATE TABLE IF NOT EXISTS data_source_health (
  source_id TEXT PRIMARY KEY,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error TEXT,
  latency_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  data_lag_seconds INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed health records
INSERT INTO data_source_health (source_id) VALUES
  ('rpc'), ('wss'), ('chainlink'), ('dexscreener'), ('coingecko'), ('uniswap_api')
ON CONFLICT (source_id) DO NOTHING;
