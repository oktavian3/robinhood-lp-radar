import "dotenv/config";
import { getAddress, formatUnits } from "viem";
import { sleep } from "../lib/helpers.js";
import { rpcClient } from "../lib/rpc.js";
import { getPools, query, insertRawEvent, updateSourceHealth } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { V2_PAIR_ABI, V3_POOL_ABI } from "../lib/abi.js";

const CHAIN_ID = 4663;
const SNAPSHOT_INTERVAL_MS = 60_000; // every 60s

let running = true;

export function stop() {
  running = false;
}

async function takeV2Snapshot(pool: { id: number; pool_address: string | null; token0: string; token1: string }) {
  if (!pool.pool_address) return;

  try {
    const addr = getAddress(pool.pool_address);
    const [reserves, token0Symbol, token1Symbol, supply] = await Promise.all([
      rpcClient.readContract({
        address: addr,
        abi: V2_PAIR_ABI,
        functionName: "getReserves",
      }).catch(() => null),
      rpcClient.readContract({
        address: getAddress(pool.token0),
        abi: [{ inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" }],
        functionName: "symbol",
      }).catch(() => null),
      rpcClient.readContract({
        address: getAddress(pool.token1),
        abi: [{ inputs: [], name: "symbol", outputs: [{ type: "string" }], stateMutability: "view", type: "function" }],
        functionName: "symbol",
      }).catch(() => null),
      rpcClient.readContract({
        address: addr,
        abi: V2_PAIR_ABI,
        functionName: "totalSupply",
      }).catch(() => null),
    ]);

    if (!reserves) return;

    const reserve0 = Number(formatUnits(reserves[0], 18));
    const reserve1 = Number(formatUnits(reserves[1], 18));
    const price = reserve0 > 0 ? reserve1 / reserve0 : 0;
    const totalSupply = supply ? Number(formatUnits(supply, 18)) : 0;

    await query(
      `INSERT INTO pool_snapshots (time, pool_db_id, source, block_number, price_token1_per_token0, tvl_usd, payload)
       VALUES (NOW(), $1, 'rpc', $2, $3, $4, $5)`,
      [
        pool.id,
        null,
        String(price),
        null, // TVL approximated
        JSON.stringify({ reserve0, reserve1, totalSupply, token0Symbol, token1Symbol }),
      ]
    );
  } catch (error) {
    // silent — pool might be dead
  }
}

async function takeV3Snapshot(pool: { id: number; pool_address: string | null }) {
  if (!pool.pool_address) return;

  try {
    const addr = getAddress(pool.pool_address);
    const [slot0, liquidity] = await Promise.all([
      rpcClient.readContract({
        address: addr,
        abi: V3_POOL_ABI,
        functionName: "slot0",
      }).catch(() => null),
      rpcClient.readContract({
        address: addr,
        abi: V3_POOL_ABI,
        functionName: "liquidity",
      }).catch(() => null),
    ]);

    if (!slot0) return;

    const sqrtPriceX96 = slot0[0];
    const tick = slot0[1];
    // price = (sqrtPriceX96 / 2^96)^2
    const price = Number(sqrtPriceX96) / (2 ** 96);
    const priceToken1PerToken0 = price * price;

    await query(
      `INSERT INTO pool_snapshots (time, pool_db_id, source, block_number, current_tick, sqrt_price_x96, active_liquidity, price_token1_per_token0, payload)
       VALUES (NOW(), $1, 'rpc', $2, $3, $4, $5, $6, $7)`,
      [
        pool.id,
        null,
        tick,
        String(sqrtPriceX96),
        liquidity ? String(liquidity) : null,
        String(priceToken1PerToken0),
        JSON.stringify({ sqrtPriceX96: String(sqrtPriceX96), tick, liquidity: liquidity ? String(liquidity) : null }),
      ]
    );
  } catch {
    // silent
  }
}

export async function startSnapshotWorker(): Promise<void> {
  logger.info("[SnapshotWorker] Starting...");

  while (running) {
    try {
      const startTime = Date.now();
      const pools = await getPools("discovered");
      let v2Count = 0;
      let v3Count = 0;

      for (const pool of pools) {
        if (pool.protocol === "v2") {
          await takeV2Snapshot(pool);
          v2Count++;
        } else if (pool.protocol === "v3") {
          await takeV3Snapshot(pool);
          v3Count++;
        } else if (pool.protocol === "v4") {
          // v4 snapshot — use StateView contract (Phase 2)
          // For now, skip v4 snapshots
        }
      }

      logger.debug(`[SnapshotWorker] ${v2Count} v2 + ${v3Count} v3 snapshots taken`);

      const elapsed = Date.now() - startTime;
      const waitTime = Math.max(0, SNAPSHOT_INTERVAL_MS - elapsed);
      await sleep(waitTime);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[SnapshotWorker] Error: ${errMsg}`);
      await sleep(10_000);
    }
  }

  logger.info("[SnapshotWorker] Stopped.");
}
