import "dotenv/config";
import { query } from "./src/db/index.js";

async function main() {
  // 1. Find pools with events
  const { rows: pools } = await query(`
    SELECT p.id, p.pool_address, 
      COALESCE(MIN(r.block_number), 0) as min_block,
      COALESCE(MAX(r.block_number), 0) as max_block,
      MIN(r.event_time) as first_event,
      MAX(r.event_time) as last_event,
      COUNT(*) as event_count
    FROM pools p
    JOIN raw_events r ON r.pool_ref = p.pool_address
    WHERE p.pool_address IS NOT NULL
    GROUP BY p.id, p.pool_address
    HAVING COALESCE(MIN(r.block_number), 0) > 0
    ORDER BY event_count DESC
    LIMIT 5
  `);

  console.log(`Pools with events: ${pools.length}`);
  for (const p of pools) {
    console.log(`\nPool ${p.id} (${p.pool_address?.slice(0,10)}):`);
    console.log(`  Events: ${p.event_count}`);
    console.log(`  Blocks: ${p.min_block} → ${p.max_block}`);
    console.log(`  Times: ${p.first_event} → ${p.last_event}`);

    // Check Swap events for this pool
    const { rows: swaps } = await query(`
      SELECT block_number, event_time, event_name, decoded->>'amount0' as a0, 
             decoded->>'amount1' as a1, decoded->>'sqrtPriceX96' as sqrtP
      FROM raw_events
      WHERE pool_ref = $1 AND event_name = 'Swap'
      ORDER BY block_number ASC
      LIMIT 3
    `, [p.pool_address]);

    console.log(`  Swap events sample:`);
    for (const s of swaps) {
      console.log(`    block=${s.block_number} time=${s.event_time} a0=${s.a0?.slice(0,8)} a1=${s.a1?.slice(0,8)} sqrtP=${s.sqrtp?.slice(0,8)}`);
    }
  }

  // 2. Check existing candles
  const { rows: candles } = await query("SELECT COUNT(*) as c FROM candles_5m");
  console.log(`\nTotal candles: ${candles[0].c}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
