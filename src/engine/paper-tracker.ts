/**
 * Paper Tracker v1 — Phase 4
 * Auto-creates paper positions from Top 10 recommendations.
 * Tracks PnL vs hold, fees, IL, rebalances.
 */
import { query } from "../db/index.js";
import { getTopPools } from "./scoring.js";
import { evaluateRangeForPool, type RangeResult } from "./range-engine.js";
import { logger } from "../lib/logger.js";
import { v4 as uuidv4 } from "uuid";

const DEFAULT_CAPITAL = 10_000; // $10k per paper position

// ─── Create paper positions from Top 10 ─────────────

export async function syncPaperPositions(): Promise<number> {
  try {
    const top = await getTopPools(10, 65);
    let created = 0;

    for (const pool of top) {
      // Check if position already exists for this pool
      const { rows: existing } = await query(
        `SELECT rp.id FROM recommendations r
         JOIN paper_positions rp ON rp.recommendation_id = r.id
         WHERE r.pool_db_id = $1 AND rp.status = 'active'
         LIMIT 1`,
        [pool.poolId]
      );
      if (existing.length > 0) continue;

      // Evaluate ranges
      const ranges = await evaluateRangeForPool(pool.poolId, DEFAULT_CAPITAL);
      if (ranges.length === 0) continue;

      // Pick best range
      const best = ranges[0];
      const recId = uuidv4();

      // Create recommendation
      await query(
        `INSERT INTO recommendations (
          id, version, pool_db_id, strategy, score, confidence, risk_level,
          current_price, lower_price, upper_price, tick_lower, tick_upper,
          deposit_asset, deposit_ratio, target_duration_hours_low, target_duration_hours_high,
          probability_12h, probability_24h, probability_3d, probability_7d,
          median_time_to_exit_hours, estimated_gross_fees_usd, estimated_il_usd,
          estimated_gas_usd, estimated_net_result_usd,
          assumptions, risk_flags, data_timestamps, immutable_payload
        ) VALUES (
          $1, 1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18, $19,
          $20, $21, $22, $23, $24,
          $25, $26, $27, $28
        )`,
        [
          recId, pool.poolId, best.candidate.strategy, pool.score, pool.confidence, pool.riskLevel,
          best.candidate.lowerPrice, best.candidate.lowerPrice, best.candidate.upperPrice,
          best.candidate.tickLower, best.candidate.tickUpper,
          best.candidate.depositAsset, JSON.stringify(best.candidate.depositRatio),
          best.estimatedDurationHours[0], best.estimatedDurationHours[1],
          best.prob12h, best.prob24h, best.prob3d, best.prob7d,
          best.medianTimeToExitHours, best.estimatedGrossFeesUsd, best.estimatedIlUsd,
          best.estimatedGasUsd, best.estimatedNetUsd,
          JSON.stringify({ capitalUsd: DEFAULT_CAPITAL }),
          JSON.stringify(pool.riskFlags),
          JSON.stringify({ generatedAt: new Date().toISOString() }),
          JSON.stringify({ poolSnapshot: pool }),
        ]
      );

      // Create paper position
      const posId = uuidv4();
      const ratio0 = best.candidate.depositRatio[0] || 0;
      const ratio1 = best.candidate.depositRatio[1] || 0;

      await query(
        `INSERT INTO paper_positions (
          id, recommendation_id, initial_capital_usd, initial_token0, initial_token1, status
        ) VALUES ($1, $2, $3, $4, $5, 'active')`,
        [
          posId, recId, DEFAULT_CAPITAL,
          (DEFAULT_CAPITAL * ratio0) / (best.candidate.lowerPrice || 1),
          DEFAULT_CAPITAL * ratio1,
        ]
      );

      // Insert first snapshot
      await query(
        `INSERT INTO position_snapshots (
          paper_position_id, token0_amount, token1_amount, position_value_usd,
          hold_value_usd, accrued_fees_usd, impermanent_loss_usd, gas_cost_usd,
          net_pnl_usd, in_range, current_tick
        ) VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0, true, $6)`,
        [
          posId,
          (DEFAULT_CAPITAL * ratio0) / (best.candidate.lowerPrice || 1),
          DEFAULT_CAPITAL * ratio1,
          DEFAULT_CAPITAL, DEFAULT_CAPITAL,
          best.candidate.tickLower,
        ]
      );

      logger.info(`[PaperTracker] Created position ${posId.slice(0,8)} for pool ${pool.poolId}`);
      created++;
    }

    return created;
  } catch (err) {
    logger.error(`[PaperTracker] sync error: ${err}`);
    return 0;
  }
}

// ─── Update existing positions —─────────────────────

export async function updatePositions(): Promise<number> {
  try {
    const { rows: active } = await query(
      "SELECT * FROM paper_positions WHERE status = 'active'"
    );
    let updated = 0;

    for (const pos of active) {
      // Get recommendation
      const { rows: recs } = await query(
        "SELECT * FROM recommendations WHERE id = $1", [pos.recommendation_id]
      );
      if (recs.length === 0) continue;
      const rec = recs[0];

      // Get latest pool snapshot
      const { rows: snapshots } = await query(
        `SELECT price_token1_per_token0 FROM pool_snapshots
         WHERE pool_db_id = $1 ORDER BY time DESC LIMIT 1`,
        [rec.pool_db_id]
      );

      const currentPrice = Number(snapshots[0]?.price_token1_per_token0 ?? rec.current_price);
      const lowerPrice = Number(rec.lower_price);
      const upperPrice = Number(rec.upper_price);
      const inRange = currentPrice >= lowerPrice && currentPrice <= upperPrice;
      const boundaryDist = inRange
        ? Math.min(
            Math.abs(currentPrice - lowerPrice) / lowerPrice,
            Math.abs(currentPrice - upperPrice) / upperPrice
          ) * 100
        : 0;

      // Calculate position value (simplified)
      const token0Amt = Number(pos.initial_token0 ?? 0);
      const token1Amt = Number(pos.initial_token1 ?? 0);
      const posValue = token0Amt * currentPrice + token1Amt;
      const holdValue = Number(pos.initial_capital_usd);

      // IL approximation
      const priceChange = (currentPrice - Number(rec.current_price)) / Number(rec.current_price);
      const il = priceChange !== 0
        ? Math.abs(2 * Math.sqrt(1 + priceChange) / (2 + priceChange) - 1)
        : 0;
      const ilUsd = il * holdValue;

      // Fees accrued (simplified — proportional to time in range)
      const hoursActive = (Date.now() - new Date(pos.opened_at).getTime()) / 3600000;
      const dailyFee = Number(rec.estimated_gross_fees_usd ?? 0) / 30; // assume 30d duration
      const accruedFees = Math.min(dailyFee * (hoursActive / 24), Number(rec.estimated_gross_fees_usd ?? 0));
      const gasUsd = Number(rec.estimated_gas_usd ?? 0.5);

      const pnl = posValue - holdValue + accruedFees - ilUsd - gasUsd;

      await query(
        `INSERT INTO position_snapshots (
          paper_position_id, token0_amount, token1_amount, position_value_usd,
          hold_value_usd, accrued_fees_usd, impermanent_loss_usd, gas_cost_usd,
          net_pnl_usd, in_range, boundary_distance_pct, current_tick
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          pos.id, token0Amt, token1Amt, posValue, holdValue,
          accruedFees, ilUsd, gasUsd, pnl,
          inRange, boundaryDist,
          rec.tick_lower ?? 0,
        ]
      );
      updated++;
    }

    return updated;
  } catch (err) {
    logger.error(`[PaperTracker] update error: ${err}`);
    return 0;
  }
}

// ─── Get positions (for API) ────────────────────────

export async function getPositions(limit = 20) {
  const { rows } = await query(`
    SELECT
      pp.id, pp.opened_at, pp.status, pp.initial_capital_usd,
      pp.rebalance_count,
      r.strategy, r.score, r.confidence,
      r.lower_price, r.upper_price,
      r.current_price, r.estimated_net_result_usd,
      r.pool_db_id, r.risk_level,
      p.protocol, p.token0, p.token1
    FROM paper_positions pp
    JOIN recommendations r ON r.id = pp.recommendation_id
    JOIN pools p ON p.id = r.pool_db_id
    ORDER BY pp.opened_at DESC
    LIMIT $1
  `, [limit]);

  // Get latest snapshot for each
  const result = [];
  for (const pos of rows) {
    const { rows: snaps } = await query(
      `SELECT * FROM position_snapshots
       WHERE paper_position_id = $1
       ORDER BY time DESC LIMIT 1`,
      [pos.id]
    );
    result.push({ ...pos, latestSnapshot: snaps[0] ?? null });
  }
  return result;
}

export async function getTrackRecord(periodDays = 30): Promise<{
  totalRecommendations: number;
  winRate: number;
  avgTimeInRange: number;
  avgFee: number;
  avgIl: number;
  avgNet: number;
  performanceByStrategy: Record<string, any>;
}> {
  const since = new Date(Date.now() - periodDays * 86400000).toISOString();

  const { rows: recs } = await query(
    `SELECT COUNT(*) as total FROM recommendations WHERE created_at >= $1`,
    [since]
  );
  const totalRecommendations = parseInt(recs[0]?.total ?? "0");

  // Win rate from latest snapshots
  const { rows: snapshots } = await query(`
    SELECT ps.net_pnl_usd, ps.in_range, ps.accrued_fees_usd,
           ps.impermanent_loss_usd, r.strategy, r.score
    FROM position_snapshots ps
    JOIN paper_positions pp ON pp.id = ps.paper_position_id
    JOIN recommendations r ON r.id = pp.recommendation_id
    WHERE ps.time >= $1
  `, [since]);

  let wins = 0;
  let totalTimeInRange = 0;
  let totalFees = 0;
  let totalIl = 0;
  let totalNet = 0;
  const byStrategy: Record<string, { count: number; net: number; wins: number }> = {};

  for (const s of snapshots) {
    const net = Number(s.net_pnl_usd ?? 0);
    if (net > 0) wins++;
    if (s.in_range) totalTimeInRange++;
    totalFees += Number(s.accrued_fees_usd ?? 0);
    totalIl += Number(s.impermanent_loss_usd ?? 0);
    totalNet += net;

    const strat = s.strategy || "unknown";
    if (!byStrategy[strat]) byStrategy[strat] = { count: 0, net: 0, wins: 0 };
    byStrategy[strat].count++;
    byStrategy[strat].net += net;
    if (net > 0) byStrategy[strat].wins++;
  }

  return {
    totalRecommendations,
    winRate: snapshots.length > 0 ? wins / snapshots.length : 0,
    avgTimeInRange: snapshots.length > 0 ? totalTimeInRange / snapshots.length : 0,
    avgFee: snapshots.length > 0 ? totalFees / snapshots.length : 0,
    avgIl: snapshots.length > 0 ? totalIl / snapshots.length : 0,
    avgNet: snapshots.length > 0 ? totalNet / snapshots.length : 0,
    performanceByStrategy: byStrategy,
  };
}
