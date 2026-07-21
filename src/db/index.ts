import "dotenv/config";
import pg from "pg";

// CRITICAL: pg v8+ returns BIGINT as string by default — force number
pg.defaults.parseInt8 = true;

const { Pool } = pg;

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://lp_radar:lp_radar@localhost:5432/lp_radar";

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const client = await pool.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ─── Types ────────────────────────────────────────────

export type DbPool = {
  id: number;
  chain_id: number;
  protocol: "v2" | "v3" | "v4";
  pool_address: string | null;
  pool_id: string | null;
  token0: string;
  token1: string;
  fee: number | null;
  tick_spacing: number | null;
  hooks: string | null;
  factory_or_manager: string;
  created_block: number | null;
  created_at: Date | null;
  status: string;
  rejection_reasons: any[];
  metadata: any;
};

export type DbBlock = {
  chain_id: number;
  block_number: number;
  block_hash: string;
  parent_hash: string;
  block_time: Date;
  canonical: boolean;
  indexed_at: Date;
};

// ─── Blocks ───────────────────────────────────────────

export async function getLatestBlock(): Promise<number | null> {
  const { rows } = await query<{ block_number: number }>(
    `SELECT block_number FROM chain_blocks
     WHERE chain_id = $1 AND canonical = true
     ORDER BY block_number DESC LIMIT 1`,
    [4663]
  );
  return rows[0]?.block_number ?? null;
}

export async function insertBlock(block: {
  chain_id: number;
  block_number: number;
  block_hash: string;
  parent_hash: string;
  block_time: Date;
}): Promise<void> {
  await query(
    `INSERT INTO chain_blocks (chain_id, block_number, block_hash, parent_hash, block_time)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (chain_id, block_number) DO UPDATE SET
       block_hash = EXCLUDED.block_hash,
       parent_hash = EXCLUDED.parent_hash,
       block_time = EXCLUDED.block_time`,
    [block.chain_id, block.block_number, block.block_hash, block.parent_hash, block.block_time]
  );
}

// ─── Pools ────────────────────────────────────────────

export async function insertPool(pool: {
  protocol: string;
  pool_address: string | null;
  pool_id: string | null;
  token0: string;
  token1: string;
  fee: number | null;
  tick_spacing: number | null;
  hooks: string | null;
  factory_or_manager: string;
  created_block: number | null;
  created_at: Date | null;
}): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO pools (chain_id, protocol, pool_address, pool_id, token0, token1, fee, tick_spacing, hooks, factory_or_manager, created_block, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (chain_id, protocol, COALESCE(pool_address,''), COALESCE(pool_id,'')) DO UPDATE SET
       status = 'discovered',
       created_block = COALESCE(pools.created_block, EXCLUDED.created_block),
       created_at = COALESCE(pools.created_at, EXCLUDED.created_at)
     RETURNING id`,
    [
      4663, pool.protocol, pool.pool_address, pool.pool_id,
      pool.token0.toLowerCase(), pool.token1.toLowerCase(),
      pool.fee, pool.tick_spacing, pool.hooks,
      pool.factory_or_manager, pool.created_block, pool.created_at,
    ]
  );
  return rows[0].id;
}

export async function getPools(status?: string): Promise<DbPool[]> {
  const { rows } = status
    ? await query<DbPool>("SELECT * FROM pools WHERE status = $1 ORDER BY created_at DESC NULLS LAST", [status])
    : await query<DbPool>("SELECT * FROM pools ORDER BY created_at DESC NULLS LAST");
  return rows;
}

export async function getPoolByAddress(address: string): Promise<DbPool | null> {
  const { rows } = await query<DbPool>(
    "SELECT * FROM pools WHERE LOWER(pool_address) = LOWER($1) OR LOWER(pool_id) = LOWER($1) LIMIT 1",
    [address]
  );
  return rows[0] ?? null;
}

export async function getPoolByTokens(token0: string, token1: string): Promise<DbPool[]> {
  const { rows } = await query<DbPool>(
    `SELECT * FROM pools WHERE
     (LOWER(token0) = LOWER($1) AND LOWER(token1) = LOWER($2))
     OR (LOWER(token0) = LOWER($2) AND LOWER(token1) = LOWER($1))
     ORDER BY protocol`,
    [token0, token1]
  );
  return rows;
}

// ─── Events ───────────────────────────────────────────

export async function insertRawEvent(event: {
  block_number: number;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  contract_address: string;
  event_name: string;
  pool_ref: string | null;
  event_time: Date;
  decoded: any;
}): Promise<void> {
  await query(
    `INSERT INTO raw_events (chain_id, block_number, block_hash, tx_hash, log_index, contract_address, event_name, pool_ref, event_time, decoded)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
    [
      4663,
      event.block_number, event.block_hash, event.tx_hash,
      event.log_index, event.contract_address.toLowerCase(),
      event.event_name, event.pool_ref, event.event_time, JSON.stringify(event.decoded),
    ]
  );
}

// ─── Health ───────────────────────────────────────────

export async function getSourceHealth() {
  const { rows } = await query("SELECT * FROM data_source_health ORDER BY source_id");
  return rows;
}

export async function updateSourceHealth(
  sourceId: string,
  ok: boolean,
  latencyMs: number,
  error?: string
): Promise<void> {
  if (ok) {
    await query(
      `UPDATE data_source_health SET
        last_success_at = NOW(), latency_ms = $2, consecutive_failures = 0, last_error = NULL, updated_at = NOW()
       WHERE source_id = $1`,
      [sourceId, latencyMs]
    );
  } else {
    await query(
      `UPDATE data_source_health SET
        last_failure_at = NOW(), last_error = $2, consecutive_failures = consecutive_failures + 1, updated_at = NOW()
       WHERE source_id = $1`,
      [sourceId, error ?? "Unknown error"]
    );
  }
}

// ─── Stats ────────────────────────────────────────────

export async function getPoolCounts(): Promise<{
  total: number;
  eligible: number;
  rejected: number;
  byProtocol: Record<string, number>;
}> {
  const { rows: total } = await query<{ count: string }>("SELECT COUNT(*) FROM pools");
  const { rows: eligible } = await query<{ count: string }>("SELECT COUNT(*) FROM pools WHERE status = 'active'");
  const { rows: rejected } = await query<{ count: string }>("SELECT COUNT(*) FROM pools WHERE status = 'rejected'");
  const { rows: byProto } = await query<{ protocol: string; count: string }>("SELECT protocol, COUNT(*) FROM pools GROUP BY protocol");

  const byProtocol: Record<string, number> = {};
  for (const r of byProto) byProtocol[r.protocol] = parseInt(r.count);

  return {
    total: parseInt(total[0]?.count ?? "0"),
    eligible: parseInt(eligible[0]?.count ?? "0"),
    rejected: parseInt(rejected[0]?.count ?? "0"),
    byProtocol,
  };
}
