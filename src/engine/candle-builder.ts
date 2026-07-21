/**
 * Candle builder v3 — handles both v2 & v3 decoded events from viem
 */
import { query } from "../db/index.js";
import { logger } from "../lib/logger.js";

const CANDLE_MS = 5 * 60 * 1000;

export async function buildCandles(): Promise<number> {
  try {
    // Find pools with Swap events that need candles
    const { rows: pools } = await query(`
      SELECT p.id, p.pool_address, p.protocol,
        MIN(r.event_time) as first_event,
        MAX(r.event_time) as last_event,
        COUNT(*) as event_count
      FROM pools p
      JOIN raw_events r ON r.pool_ref = p.pool_address
      WHERE p.pool_address IS NOT NULL AND r.event_name = 'Swap'
      GROUP BY p.id, p.pool_address, p.protocol
      HAVING COUNT(*) >= 2
    `);

    if (pools.length === 0) return 0;

    let built = 0;

    for (const pool of pools) {
      const poolDbId = pool.id;
      const isV2 = pool.protocol === "v2";

      // Get all Swap events for this pool
      const { rows: events } = await query(`
        SELECT block_number, event_time, decoded
        FROM raw_events
        WHERE pool_ref = $1 AND event_name = 'Swap'
        ORDER BY block_number ASC
      `, [pool.pool_address]);

      if (events.length < 2) continue;

      // Determine time range
      let firstMs = events[0].event_time.getTime();
      let lastMs = events[events.length - 1].event_time.getTime();

      // If times are too close, estimate from block numbers
      if (lastMs - firstMs < 60_000) {
        const firstB = events[0].block_number;
        const lastB = events[events.length - 1].block_number;
        const totalBlocks = lastB - firstB;
        if (totalBlocks > 0) {
          const now = Date.now();
          // Assume ~2s per block
          firstMs = now - (totalBlocks * 2000) - 300_000;
          lastMs = now;
        }
      }

      const firstBucket = Math.floor(firstMs / CANDLE_MS) * CANDLE_MS;
      const lastBucket = Math.floor(lastMs / CANDLE_MS) * CANDLE_MS;

      // Get existing buckets
      const { rows: existing } = await query(
        "SELECT DISTINCT bucket FROM candles_5m WHERE pool_db_id = $1",
        [poolDbId]
      );
      const haveBuckets = new Set(
        existing.map((r: any) => new Date(r.bucket).getTime())
      );

      // Process each bucket
      for (let bucket = firstBucket; bucket <= lastBucket; bucket += CANDLE_MS) {
        if (haveBuckets.has(bucket)) continue;

        const bucketEnd = bucket + CANDLE_MS;

        // Filter events in this bucket (by time or block estimate)
        let bucketEvents = events.filter((e: any) => {
          const t = e.event_time.getTime();
          return t >= bucket && t < bucketEnd;
        });

        // If no events matched by time, use block-number approximation
        if (bucketEvents.length === 0 && lastMs - firstMs < 60_000) {
          const totalBlocks = events[events.length - 1].block_number - events[0].block_number;
          if (totalBlocks > 0) {
            const bucketFrac = (bucket - firstBucket) / (lastBucket - firstBucket);
            const blockStart = events[0].block_number + Math.floor(bucketFrac * totalBlocks);
            const blockEnd = events[0].block_number + Math.floor(((bucket + CANDLE_MS) - firstBucket) / (lastBucket - firstBucket) * totalBlocks);
            bucketEvents = events.filter((e: any) =>
              e.block_number >= blockStart && e.block_number < blockEnd
            );
          }
        }

        if (bucketEvents.length === 0) continue;

        // Build OHLCV
        let open = 0, high = 0, low = Infinity, close = 0;
        let baseVol = 0, quoteVol = 0, tradeCount = 0;

        for (const ev of bucketEvents) {
          const d = ev.decoded;
          let price = 0;

          if (isV2) {
            // v2: amount0In, amount1In, amount0Out, amount1Out
            const a0In = Number(d.amount0In ?? 0) / 1e18;
            const a1In = Number(d.amount1In ?? 0) / 1e18;
            const a0Out = Number(d.amount0Out ?? 0) / 1e18;
            const a1Out = Number(d.amount1Out ?? 0) / 1e18;
            const totalA0 = a0In + a0Out;
            const totalA1 = a1In + a1Out;
            price = totalA0 > 0 ? totalA1 / totalA0 : 0;
            baseVol += totalA0;
            quoteVol += totalA1;
          } else {
            // v3: use sqrtPriceX96 as PRIMARY price source (amount0/amount1 are int256,
            // negative values wrap to near uint256.max, making a1/a0 garbage)
            if (d.sqrtPriceX96) {
              const sqrtP = Number(d.sqrtPriceX96) / (2 ** 96);
              price = sqrtP * sqrtP;
            }
            // Fallback to tick
            if (price === 0 && d.tick !== undefined && d.tick !== null) {
              price = Math.pow(1.0001, Number(d.tick));
            }
            // amount0/amount1 ONLY for volume tracking
            if (d.amount0 !== undefined && d.amount1 !== undefined) {
              const raw0 = BigInt(d.amount0);
              const raw1 = BigInt(d.amount1);
              const MAX = BigInt(2) ** BigInt(255);
              const a0 = raw0 > MAX ? Number(BigInt(2) ** BigInt(256) - raw0) : Number(raw0);
              const a1 = raw1 > MAX ? Number(BigInt(2) ** BigInt(256) - raw1) : Number(raw1);
              baseVol += Math.abs(a0);
              quoteVol += Math.abs(a1);
            }
          }

          if (price > 0 && isFinite(price) && price < 1e20) {
            if (open === 0) open = price;
            high = Math.max(high, price);
            low = Math.min(low, price);
            close = price;
            tradeCount++;
          }
        }

        if (tradeCount > 0 && open > 0) {
          await query(`
            INSERT INTO candles_5m (bucket, pool_db_id, source, open, high, low, close, base_volume, quote_volume, trade_count, is_backfilled)
            VALUES ($1, $2, 'indexer', $3, $4, $5, $6, $7, $8, $9, true)
            ON CONFLICT (bucket, pool_db_id, source) DO UPDATE SET
              high = GREATEST(candles_5m.high, EXCLUDED.high),
              low = LEAST(candles_5m.low, EXCLUDED.low),
              close = EXCLUDED.close,
              base_volume = candles_5m.base_volume + EXCLUDED.base_volume,
              quote_volume = candles_5m.quote_volume + EXCLUDED.quote_volume,
              trade_count = candles_5m.trade_count + EXCLUDED.trade_count,
              is_backfilled = true
          `, [
            new Date(bucket), poolDbId, open, high, low, close,
            Math.round(baseVol), Math.round(quoteVol), tradeCount,
          ]);
          built++;
        }
      }
    }

    return built;
  } catch (err) {
    logger.error(`[CandleBuilder] Error: ${err}`);
    return 0;
  }
}
