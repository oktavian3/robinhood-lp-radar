import "dotenv/config";
import { getAddress } from "viem";
import { sleep, safeStr } from "../lib/helpers.js";
import { rpcClient } from "../lib/rpc.js";
import { searchPairs } from "../lib/dexscreener.js";
import { insertPool, updateSourceHealth } from "../db/index.js";
import { logger } from "../lib/logger.js";
import { V2_FACTORY_ABI, V3_FACTORY_ABI, V4_POOLMANAGER_ABI } from "../lib/abi.js";
import contracts from "../../config/contracts.json" with { type: "json" };

const DISCOVER_MS = 60_000;
const AGGREGATOR_MS = 15 * 60_000;
const V2_FACTORY = contracts.uniswapV2.factory.toLowerCase();
const V3_FACTORY = contracts.uniswapV3.factory.toLowerCase();
const V4_MANAGER = contracts.uniswapV4.poolManager.toLowerCase();

let running = true;
let v2Cursor = 0n, v3Cursor = 0n, v4Cursor = 0n;
let lastAggregatorCheck = 0;
export function stop() { running = false; }

async function safeInsert(args: Record<string, any>, factory: string, protocol: string) {
  const t0 = args.token0 ?? args.currency0 ?? args[0];
  const t1 = args.token1 ?? args.currency1 ?? args[1];
  if (!t0 || !t1) return;
  const addr = args.pair ?? null;
  const poolId = args.poolId ?? null;
  const fee = args.fee ?? null;
  const ts = args.tickSpacing ?? null;
  const hooksRaw = args.hooks ?? null;

  try {
    await insertPool({
      protocol,
      pool_address: protocol !== "v4" ? safeStr(addr) : null,
      pool_id: protocol === "v4" ? safeStr(poolId) : null,
      token0: safeStr(t0),
      token1: safeStr(t1),
      fee: fee != null ? Number(fee) : null,
      tick_spacing: ts != null ? Number(ts) : null,
      hooks: hooksRaw ? safeStr(hooksRaw) : null,
      factory_or_manager: factory,
      created_block: null,
      created_at: null,
    });
  } catch (e: any) {
    logger.warn(`[PoolDiscovery] ${protocol} insert err: ${e?.message ?? e}`);
  }
}

async function discoverV2() {
  try {
    const latest = await rpcClient.getBlockNumber();
    const from = v2Cursor === 0n ? latest - 5000n : v2Cursor;
    const logs = await rpcClient.getContractEvents({
      address: getAddress(V2_FACTORY), abi: V2_FACTORY_ABI, eventName: "PairCreated",
      fromBlock: from, toBlock: "latest",
    });
    for (const log of logs) {
      await safeInsert(log.args as any, V2_FACTORY, "v2");
    }
    if (logs.length > 0) logger.info(`[PoolDiscovery] v2: ${logs.length} pools`);
    v2Cursor = latest + 1n;
  } catch (e: any) {
    logger.error(`[PoolDiscovery] v2 error: ${e?.message ?? e}`);
  }
}

async function discoverV3() {
  try {
    const latest = await rpcClient.getBlockNumber();
    const from = v3Cursor === 0n ? latest - 5000n : v3Cursor;
    const logs = await rpcClient.getContractEvents({
      address: getAddress(V3_FACTORY), abi: V3_FACTORY_ABI, eventName: "PoolCreated",
      fromBlock: from, toBlock: "latest",
    });
    for (const log of logs) {
      await safeInsert(log.args as any, V3_FACTORY, "v3");
    }
    if (logs.length > 0) logger.info(`[PoolDiscovery] v3: ${logs.length} pools`);
    v3Cursor = latest + 1n;
  } catch (e: any) {
    logger.error(`[PoolDiscovery] v3 error: ${e?.message ?? e}`);
  }
}

async function discoverV4() {
  try {
    const latest = await rpcClient.getBlockNumber();
    const from = v4Cursor === 0n ? latest - 5000n : v4Cursor;
    const logs = await rpcClient.getContractEvents({
      address: getAddress(V4_MANAGER), abi: V4_POOLMANAGER_ABI, eventName: "Initialize",
      fromBlock: from, toBlock: "latest",
    });
    for (const log of logs) {
      await safeInsert(log.args as any, V4_MANAGER, "v4");
    }
    if (logs.length > 0) logger.info(`[PoolDiscovery] v4: ${logs.length} pools`);
    v4Cursor = latest + 1n;
  } catch (e: any) {
    logger.error(`[PoolDiscovery] v4 error: ${e?.message ?? e}`);
  }
}

async function crossCheckDex() {
  try {
    const start = Date.now();
    const pairs = await searchPairs("robinhood");
    let found = 0;
    for (const pair of pairs) {
      if (!pair.pairAddress || !pair.baseToken || !pair.quoteToken) continue;
      const proto = pair.labels?.includes("v4") ? "v4" : pair.labels?.includes("v3") ? "v3" : "v2";
      try {
        await insertPool({
          protocol: proto,
          pool_address: proto !== "v4" ? pair.pairAddress.toLowerCase() : null,
          pool_id: proto === "v4" ? pair.pairAddress.toLowerCase() : null,
          token0: pair.baseToken.address.toLowerCase(),
          token1: pair.quoteToken.address.toLowerCase(),
          fee: null, tick_spacing: null, hooks: null,
          factory_or_manager: proto === "v4" ? V4_MANAGER : proto === "v3" ? V3_FACTORY : V2_FACTORY,
          created_block: null,
          created_at: pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : null,
        });
        found++;
      } catch { /* dup */ }
    }
    await updateSourceHealth("dexscreener", true, Date.now() - start);
    logger.info(`[PoolDiscovery] DEX: ${found} new`);
  } catch (e: any) {
    await updateSourceHealth("dexscreener", false, 0, e?.message ?? String(e));
    logger.error(`[PoolDiscovery] DEX error: ${e?.message ?? e}`);
  }
}

export async function startPoolDiscovery(): Promise<void> {
  logger.info("[PoolDiscovery] Starting...");
  while (running) {
    try {
      const start = Date.now();
      await discoverV2();
      await discoverV3();
      await discoverV4();
      if (Date.now() - lastAggregatorCheck > AGGREGATOR_MS) {
        await crossCheckDex();
        lastAggregatorCheck = Date.now();
      }
      await sleep(Math.max(0, DISCOVER_MS - (Date.now() - start)));
    } catch (e: any) {
      logger.error(`[PoolDiscovery] ${e?.message ?? e}`);
      await sleep(10_000);
    }
  }
}
