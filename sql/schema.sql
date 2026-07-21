CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS chain_blocks (
  chain_id INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  block_time TIMESTAMPTZ NOT NULL,
  canonical BOOLEAN NOT NULL DEFAULT TRUE,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, block_number)
);

CREATE TABLE IF NOT EXISTS tokens (
  chain_id INTEGER NOT NULL,
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

CREATE TABLE IF NOT EXISTS pools (
  id BIGSERIAL PRIMARY KEY,
  chain_id INTEGER NOT NULL,
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
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (chain_id, protocol, COALESCE(pool_address, ''), COALESCE(pool_id, ''))
);

CREATE TABLE IF NOT EXISTS raw_events (
  chain_id INTEGER NOT NULL,
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

CREATE TABLE IF NOT EXISTS pool_snapshots (
  time TIMESTAMPTZ NOT NULL,
  pool_db_id BIGINT NOT NULL REFERENCES pools(id),
  source TEXT NOT NULL,
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
SELECT create_hypertable('pool_snapshots', 'time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS candles_5m (
  bucket TIMESTAMPTZ NOT NULL,
  pool_db_id BIGINT NOT NULL REFERENCES pools(id),
  source TEXT NOT NULL,
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
SELECT create_hypertable('candles_5m', 'bucket', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS tick_liquidity (
  time TIMESTAMPTZ NOT NULL,
  pool_db_id BIGINT NOT NULL REFERENCES pools(id),
  tick INTEGER NOT NULL,
  liquidity_net NUMERIC,
  liquidity_gross NUMERIC,
  source TEXT NOT NULL,
  PRIMARY KEY (time, pool_db_id, tick)
);
SELECT create_hypertable('tick_liquidity', 'time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS oracle_snapshots (
  time TIMESTAMPTZ NOT NULL,
  token_address TEXT NOT NULL,
  feed_address TEXT,
  answer NUMERIC,
  decimals INTEGER,
  updated_at TIMESTAMPTZ,
  heartbeat_seconds INTEGER,
  sequencer_up BOOLEAN,
  oracle_paused BOOLEAN,
  ui_multiplier NUMERIC,
  is_valid BOOLEAN NOT NULL,
  rejection_reason TEXT,
  PRIMARY KEY (time, token_address)
);
SELECT create_hypertable('oracle_snapshots', 'time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  pool_db_id BIGINT NOT NULL REFERENCES pools(id),
  strategy TEXT NOT NULL,
  score NUMERIC NOT NULL,
  confidence NUMERIC NOT NULL,
  risk_level TEXT NOT NULL,
  current_price NUMERIC NOT NULL,
  lower_price NUMERIC NOT NULL,
  upper_price NUMERIC NOT NULL,
  tick_lower INTEGER,
  tick_upper INTEGER,
  deposit_asset TEXT NOT NULL,
  deposit_ratio JSONB NOT NULL,
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
  immutable_payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendation_rankings (
  time TIMESTAMPTZ NOT NULL,
  recommendation_id UUID NOT NULL REFERENCES recommendations(id),
  rank INTEGER NOT NULL,
  score NUMERIC NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (time, recommendation_id)
);
SELECT create_hypertable('recommendation_rankings', 'time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS paper_positions (
  id UUID PRIMARY KEY,
  recommendation_id UUID NOT NULL REFERENCES recommendations(id),
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  initial_capital_usd NUMERIC NOT NULL,
  initial_token0 NUMERIC,
  initial_token1 NUMERIC,
  status TEXT NOT NULL,
  rebalance_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  time TIMESTAMPTZ NOT NULL,
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
  current_tick INTEGER,
  PRIMARY KEY (time, paper_position_id)
);
SELECT create_hypertable('position_snapshots', 'time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ
);

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

CREATE INDEX IF NOT EXISTS idx_pools_tokens ON pools(chain_id, token0, token1);
CREATE INDEX IF NOT EXISTS idx_raw_events_pool_time ON raw_events(pool_ref, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_created ON recommendations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_entity ON alerts(entity_type, entity_id, created_at DESC);
