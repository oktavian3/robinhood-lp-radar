import "dotenv/config";
import { startBlockCursor } from "./indexer/block-cursor.js";
import { startPoolDiscovery } from "./indexer/pool-discovery.js";
import { startEventProcessor } from "./indexer/event-processor.js";
import { startSnapshotWorker } from "./indexer/snapshot-worker.js";
import { startRankingWorker } from "./engine/ranker.js";
import { startHealthServer } from "./health/server.js";
import { logger } from "./lib/logger.js";

async function main() {
  logger.info("╔══════════════════════════════════════╗");
  logger.info("║  Robinhood LP Radar — Degen Edition  ║");
  logger.info("╚══════════════════════════════════════╝");

  await Promise.allSettled([
    startBlockCursor(),
    startPoolDiscovery(),
    startEventProcessor(),
    startSnapshotWorker(),
    startRankingWorker(),
    startHealthServer(),
  ]);

  logger.info("[Main] All workers stopped.");
}

// Don't exit on SIGTERM — let the process manage itself
process.on("SIGINT", () => { logger.info("[Main] Shutdown"); process.exit(0); });
process.on("SIGTERM", () => { logger.info("[Main] SIGTERM received — ignoring"); });

main().catch((err) => { logger.error(`[Main] Fatal: ${err}`); process.exit(1); });
