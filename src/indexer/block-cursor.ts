import "dotenv/config";
import { sleep } from "../lib/helpers.js";
import { rpcClient } from "../lib/rpc.js";
import { getLatestBlock, insertBlock, updateSourceHealth, query } from "../db/index.js";
import { logger } from "../lib/logger.js";

const CHAIN_ID = 4663;
const POLL_MS = 5_000;
const MAX_BACKFILL = 50;

let running = true;
export function stop() { running = false; }

export async function startBlockCursor(): Promise<void> {
  logger.info("[BlockCursor] Starting...");
  let consecErrors = 0;

  while (running) {
    try {
      const started = Date.now();
      const latest = Number(await rpcClient.getBlockNumber());
      const stored = await getLatestBlock(); // now always number thanks to parseInt8
      const cursor = Math.max(0, Number(stored ?? (latest - MAX_BACKFILL)));

      // Backfill missing blocks
      if (cursor < latest) {
        const count = Math.min(latest - cursor, MAX_BACKFILL);
        if (count > 0) {
          logger.info(`[BlockCursor] Backfill ${count} blocks (${cursor + 1} → ${cursor + count})`);
          for (let i = 1; i <= count; i++) {
            const bn = BigInt(cursor + i);
            const b = await rpcClient.getBlock({ blockNumber: bn });
            if (b?.hash && b?.timestamp) {
              await insertBlock({
                chain_id: CHAIN_ID,
                block_number: cursor + i,
                block_hash: b.hash,
                parent_hash: b.parentHash,
                block_time: new Date(Number(b.timestamp) * 1000),
              });
            }
          }
        }
      }

      // Always store latest
      const b = await rpcClient.getBlock({ blockNumber: BigInt(latest) });
      if (b?.hash && b?.timestamp) {
        await insertBlock({
          chain_id: CHAIN_ID,
          block_number: latest,
          block_hash: b.hash,
          parent_hash: b.parentHash,
          block_time: new Date(Number(b.timestamp) * 1000),
        });
      }

      consecErrors = 0;
      await updateSourceHealth("rpc", true, Date.now() - started);
      await sleep(Math.max(0, POLL_MS - (Date.now() - started)));
    } catch (err) {
      consecErrors++;
      logger.error(`[BlockCursor] Error #${consecErrors}: ${err}`);
      await updateSourceHealth("rpc", false, 0, String(err));
      await sleep(Math.min(30_000, consecErrors * 5_000));
      if (consecErrors >= 20) {
        logger.error("[BlockCursor] Too many errors, pausing for 5 min");
        await sleep(300_000);
        consecErrors = 0;
      }
    }
  }
}
