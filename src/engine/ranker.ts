/**
 * Ranking worker v3 — scoring + range + paper tracking
 * Phase 4: full pipeline
 */
import { sleep } from "../lib/helpers.js";
import { updatePoolStatuses, getTopPools } from "./scoring.js";
import { buildCandles } from "./candle-builder.js";
import { evaluateRangeForPool } from "./range-engine.js";
import { syncPaperPositions, updatePositions } from "./paper-tracker.js";
import { logger } from "../lib/logger.js";

const RANK_MS = 15 * 60_000;
const CANDLE_MS = 5 * 60_000;
const POSITION_MS = 5 * 60_000;

let running = true;
export function stop() { running = false; }

export async function startRankingWorker(): Promise<void> {
  logger.info("[Ranker] Starting (Phase 4)...");
  let lastCandle = 0;
  let lastPosition = 0;

  while (running) {
    try {
      const started = Date.now();

      // 1. Candles
      if (Date.now() - lastCandle >= CANDLE_MS) {
        const count = await buildCandles();
        if (count > 0) logger.info(`[Ranker] ${count} candles`);
        lastCandle = Date.now();
      }

      // 2. Hard filters
      await updatePoolStatuses();

      // 3. Range engine (top 5)
      const top = await getTopPools(25, 0);
      for (const pool of top.slice(0, 5)) {
        const ranges = await evaluateRangeForPool(pool.poolId);
        if (ranges.length > 0) {
          logger.debug(`[Ranker] Range for pool ${pool.poolId}: best=${ranges[0].candidate.label} net=$${ranges[0].estimatedNetUsd}`);
        }
      }

      // 4. Paper positions
      if (top.some(t => t.score >= 65)) {
        const created = await syncPaperPositions();
        if (created > 0) logger.info(`[Ranker] Paper positions: ${created} new`);
      }

      // 5. Position snapshots
      if (Date.now() - lastPosition >= POSITION_MS) {
        const updated = await updatePositions();
        if (updated > 0) logger.debug(`[Ranker] Position snapshots: ${updated}`);
        lastPosition = Date.now();
      }

      // 6. Log summary
      const eligible = top.filter(t => t.score >= 65);
      const msg = eligible.length > 0
        ? `Top: ${eligible.length} eligible, #1 score=${eligible[0].score}`
        : `Top: 0 eligible (need data accumulation)`;
      logger.info(`[Ranker] ${msg}`);

      await sleep(Math.max(0, RANK_MS - (Date.now() - started)));
    } catch (err) {
      logger.error(`[Ranker] Error: ${err}`);
      await sleep(30_000);
    }
  }
}
