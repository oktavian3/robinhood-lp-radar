import "dotenv/config";
import { rpcClient } from "./src/lib/rpc.js";
import { insertRawEvent, query } from "./src/db/index.js";
import { logger } from "./src/lib/logger.js";

const BATCH_SIZE = 5000;
const MAX_CONCURRENT = 8;
const CHAIN_ID = 4663;

// ── Hex decoder ───────────────────────────────
const TOPIC_V2_SWAP = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
const TOPIC_V2_SYNC = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
const TOPIC_V3_SWAP = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

function hexToBigInt(hex: string): bigint {
  try { return BigInt(hex); } catch { return 0n; }
}

function decodeLog(log: any, protocol: string): { event_name: string; decoded: any } {
  const topic0 = (log.topics?.[0] ?? "").toLowerCase();
  const data = log.data ?? "0x";
  const hex = data.startsWith("0x") ? data.slice(2) : data;

  try {
    if (topic0 === TOPIC_V2_SWAP || topic0 === TOPIC_V3_SWAP) {
      const isV3 = protocol === "v3" || protocol === "v4";
      if (isV3) {
        const amount0 = hexToBigInt("0x" + hex.slice(0, 64));
        const amount1 = hexToBigInt("0x" + hex.slice(64, 128));
        const sqrtPriceX96 = hexToBigInt("0x" + hex.slice(128, 192));
        const liquidity = hexToBigInt("0x" + hex.slice(192, 256));
        const tick = parseInt(hex.slice(256, 264), 16);
        return {
          event_name: "Swap",
          decoded: {
            sender: log.topics?.[1], recipient: log.topics?.[2],
            amount0: amount0.toString(), amount1: amount1.toString(),
            sqrtPriceX96: sqrtPriceX96.toString(), liquidity: liquidity.toString(),
            tick: tick >= 0x800000 ? tick - 0x1000000 : tick,
          },
        };
      } else {
        return {
          event_name: "Swap",
          decoded: {
            sender: log.topics?.[1], to: log.topics?.[2],
            amount0In: hexToBigInt("0x" + hex.slice(0, 64)).toString(),
            amount1In: hexToBigInt("0x" + hex.slice(64, 128)).toString(),
            amount0Out: hexToBigInt("0x" + hex.slice(128, 192)).toString(),
            amount1Out: hexToBigInt("0x" + hex.slice(192, 256)).toString(),
          },
        };
      }
    }
    if (topic0 === TOPIC_V2_SYNC) {
      return { event_name: "Sync", decoded: { reserve0: hexToBigInt("0x" + hex.slice(0, 64)).toString(), reserve1: hexToBigInt("0x" + hex.slice(64, 128)).toString() } };
    }
  } catch {}
  return { event_name: "unknown", decoded: { topics: log.topics, data: log.data } };
}

// ── Block time cache ──────────────────────────
const blockTimeCache = new Map<number, Date>();
async function getBlockTime(bn: number): Promise<Date> {
  const c = blockTimeCache.get(bn);
  if (c) return c;
  try {
    const b: any = await rpcClient.request({ method: "eth_getBlockByNumber", params: ["0x" + bn.toString(16), false] });
    if (b?.timestamp) {
      const d = new Date(parseInt(b.timestamp, 16) * 1000);
      if (blockTimeCache.size > 10000) blockTimeCache.clear();
      blockTimeCache.set(bn, d);
      return d;
    }
  } catch {}
  return new Date();
}

// ── Backfill single pool ──────────────────────
async function backfillPool(p: any): Promise<number> {
  const latest = Number(await rpcClient.getBlockNumber());
  const fromBlock = p.created_block ? Math.max(0, Number(p.created_block) - 100) : Math.max(0, latest - 50000);
  let cursor = fromBlock;
  let events = 0;

  while (cursor < latest) {
    const toBlock = Math.min(cursor + BATCH_SIZE, latest);
    try {
      const result: any = await rpcClient.request({
        method: "eth_getLogs",
        params: [{ address: p.pool_address, fromBlock: "0x" + cursor.toString(16), toBlock: "0x" + toBlock.toString(16) }],
      });
      for (const log of (result ?? [])) {
        const bn = parseInt(log.blockNumber, 16);
        const { event_name, decoded } = decodeLog(log, p.protocol);
        const eventTime = await getBlockTime(bn);
        await query(
          `INSERT INTO raw_events (chain_id, block_number, block_hash, tx_hash, log_index, contract_address, event_name, pool_ref, event_time, decoded)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
          [CHAIN_ID, bn, log.blockHash, log.transactionHash, parseInt(log.logIndex, 16), p.pool_address.toLowerCase(),
           event_name, p.pool_address, eventTime, JSON.stringify(decoded)]
        );
        events++;
      }
    } catch {}
    cursor = toBlock;
  }
  return events;
}

// ── Main ──────────────────────────────────────
async function main() {
  const { rows: pools } = await query("SELECT * FROM pools WHERE pool_address IS NOT NULL AND pool_address != '0x' ORDER BY id");
  console.log(`Backfilling ${pools.length} pools (concurrency: ${MAX_CONCURRENT})...`);
  console.log(`Time: ${new Date().toISOString()}`);

  const startTotal = Date.now();
  let totalEvents = 0;
  let completed = 0;

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < pools.length; i += MAX_CONCURRENT) {
    const batch = pools.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(batch.map(p => backfillPool(p).catch(e => { console.error(`Pool ${p.id} error:`, e?.message?.slice(0,100)); return 0; })));
    const batchEvents = results.reduce((a: number, b: number) => a + b, 0);
    totalEvents += batchEvents;
    completed += batch.length;
    const elapsed = ((Date.now() - startTotal) / 1000).toFixed(0);
    process.stdout.write(`\r${completed}/${pools.length} pools · ${totalEvents} events · ${elapsed}s`);
  }

  const elapsed = ((Date.now() - startTotal) / 1000).toFixed(1);
  console.log(`\n\nDone! ${totalEvents} events from ${completed} pools in ${elapsed}s`);
  console.log(`Avg: ${(totalEvents / Math.max(1, elapsed)).toFixed(1)} events/sec`);

  // Verify
  const { rows: count } = await query("SELECT COUNT(*) as c FROM raw_events");
  console.log(`Total in DB: ${count[0].c}`);
  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
