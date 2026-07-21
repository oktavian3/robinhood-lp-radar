import "dotenv/config";
import { sleep } from "../lib/helpers.js";
import { rpcClient } from "../lib/rpc.js";
import { getLatestBlock, insertRawEvent, getPools, query } from "../db/index.js";
import { logger } from "../lib/logger.js";

// ── Known event topic0 hashes (Robinhood Chain) ──
// These are what the chain actually emits — may differ from standard Uniswap
const TOPIC_V2_SWAP  = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"; // Swap(address,uint256,uint256,uint256,uint256,address)
const TOPIC_V2_SYNC  = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"; // Sync(uint112,uint112)
const TOPIC_V2_MINT  = "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4"; // Mint(address,uint256,uint256)
const TOPIC_V2_BURN  = "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496"; // Burn(address,uint256,uint256,address)
const TOPIC_V3_SWAP  = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"; // Swap(address,address,int256,int256,uint160,uint128,int24)
const TOPIC_V3_MINT  = "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde";
const TOPIC_V3_BURN  = "0x0c396cd989a39f4459b5fa1aed6a9c8d1bc4632e516f495a4f7ef31f97e5e65";
const TOPIC_V3_COLLECT = "0x70935338e697754f5c44b686ab5e4e77aab8e9ba2d79b2e38a236f0ee8b5c8f";

// ── Manual hex decoder ────────────────────────
function hexToBigInt(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  try { return BigInt(hex); } catch { return 0n; }
}

function decodeSwap(log: any, isV3: boolean): any {
  const data = log.data ?? "0x";
  const hex = data.startsWith("0x") ? data.slice(2) : data;

  if (isV3) {
    // v3 Swap: amount0(int256/32B) + amount1(int256/32B) + sqrtPriceX96(uint160/32B) + liquidity(uint128/32B) + tick(int24/32B)
    const amount0 = hexToBigInt("0x" + hex.slice(0, 64));
    const amount1 = hexToBigInt("0x" + hex.slice(64, 128));
    const sqrtPriceX96 = hexToBigInt("0x" + hex.slice(128, 192));
    const liquidity = hexToBigInt("0x" + hex.slice(192, 256));
    const tick = parseInt(hex.slice(256, 264), 16);
    // Handle int24 signed
    const tickSigned = tick >= 0x800000 ? tick - 0x1000000 : tick;
    return {
      event_name: "Swap",
      decoded: {
        sender: log.topics?.[1] ?? "0x",
        recipient: log.topics?.[2] ?? "0x",
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        sqrtPriceX96: sqrtPriceX96.toString(),
        liquidity: liquidity.toString(),
        tick: tickSigned,
      },
    };
  } else {
    // v2 Swap: amount0In(256/32B) + amount1In(256/32B) + amount0Out(256/32B) + amount1Out(256/32B)
    const amount0In = hexToBigInt("0x" + hex.slice(0, 64));
    const amount1In = hexToBigInt("0x" + hex.slice(64, 128));
    const amount0Out = hexToBigInt("0x" + hex.slice(128, 192));
    const amount1Out = hexToBigInt("0x" + hex.slice(192, 256));
    return {
      event_name: "Swap",
      decoded: {
        sender: log.topics?.[1] ?? "0x",
        to: log.topics?.[2] ?? "0x",
        amount0In: amount0In.toString(),
        amount1In: amount1In.toString(),
        amount0Out: amount0Out.toString(),
        amount1Out: amount1Out.toString(),
      },
    };
  }
}

function decodeSync(log: any): any {
  const hex = (log.data ?? "0x").slice(2);
  return {
    event_name: "Sync",
    decoded: {
      reserve0: hexToBigInt("0x" + hex.slice(0, 64)).toString(),
      reserve1: hexToBigInt("0x" + hex.slice(64, 128)).toString(),
    },
  };
}

function decodeUnknown(log: any): any {
  return { event_name: "unknown", decoded: { topics: log.topics, data: log.data } };
}

function decodeLog(log: any, protocol: string): { event_name: string; decoded: any } {
  const topic0 = (log.topics?.[0] ?? "").toLowerCase();
  try {
    switch (topic0) {
      case TOPIC_V2_SWAP:
      case TOPIC_V3_SWAP:
        return decodeSwap(log, protocol === "v3" || protocol === "v4");
      case TOPIC_V2_SYNC:
        return decodeSync(log);
      case TOPIC_V2_MINT:
      case TOPIC_V3_MINT:
        return { event_name: "Mint", decoded: { sender: log.topics?.[1], data: log.data } };
      case TOPIC_V2_BURN:
      case TOPIC_V3_BURN:
        return { event_name: "Burn", decoded: { sender: log.topics?.[1], data: log.data } };
      case TOPIC_V3_COLLECT:
        return { event_name: "Collect", decoded: { data: log.data } };
      default:
        return decodeUnknown(log);
    }
  } catch {
    return decodeUnknown(log);
  }
}

// ── Block timestamp cache ─────────────────────
const blockTimeCache = new Map<number, Date>();

async function getBlockTime(blockNumber: number): Promise<Date> {
  const cached = blockTimeCache.get(blockNumber);
  if (cached) return cached;
  try {
    const block: any = await rpcClient.request({
      method: "eth_getBlockByNumber",
      params: [("0x" + blockNumber.toString(16)) as any, false],
    });
    if (block?.timestamp) {
      const d = new Date(parseInt(block.timestamp, 16) * 1000);
      if (blockTimeCache.size > 5000) blockTimeCache.clear();
      blockTimeCache.set(blockNumber, d);
      return d;
    }
  } catch {}
  return new Date();
}

// ── Process logs for a range ──────────────────
async function processLogs(pools: any[], fromBlock: number, toBlock: number): Promise<number> {
  let count = 0;
  for (const p of pools) {
    try {
      const result: any = await rpcClient.request({
        method: "eth_getLogs",
        params: [{
          address: p.pool_address,
          fromBlock: ("0x" + fromBlock.toString(16)) as any,
          toBlock: ("0x" + toBlock.toString(16)) as any,
        }],
      });
      for (const log of (result ?? [])) {
        const bn = parseInt(log.blockNumber, 16);
        const { event_name, decoded } = decodeLog(log, p.protocol);
        const eventTime = await getBlockTime(bn);
        await insertRawEvent({
          block_number: bn,
          block_hash: log.blockHash,
          tx_hash: log.transactionHash,
          log_index: parseInt(log.logIndex, 16),
          contract_address: p.pool_address,
          event_name,
          pool_ref: p.pool_address,
          event_time: eventTime,
          decoded,
        });
        count++;
      }
    } catch {
      // skip RPC errors per pool
    }
  }
  return count;
}

let running = true;
export function stop() { running = false; }

export async function startEventProcessor(): Promise<void> {
  logger.info("[EventProcessor] Starting...");
  const pools = await getPools();
  const withAddress = pools.filter(p => p.pool_address && p.pool_address !== "0x");
  logger.info(`[EventProcessor] ${withAddress.length} pools — forward scan only`);

  // Forward scan only (backfill done by standalone script)
  let forwardCursor = await getLatestBlock() ?? Number(await rpcClient.getBlockNumber());
  logger.info(`[EventProcessor] Starting from block ${forwardCursor}`);

  while (running) {
    try {
      const latest = Number(await rpcClient.getBlockNumber());
      if (forwardCursor < latest) {
        const to = Math.min(forwardCursor + 2000, latest);
        await processLogs(withAddress, forwardCursor + 1, to);
        forwardCursor = to;
      }

      const { rows } = await query("SELECT COUNT(*) as c FROM raw_events");
      logger.info(`[EventProcessor] Events: ${rows[0]?.c ?? 0}`);
      await sleep(30_000);
    } catch (err) {
      logger.error(`[EventProcessor] ${err}`);
      await sleep(30_000);
    }
  }
}
