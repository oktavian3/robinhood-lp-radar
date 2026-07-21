/**
 * Scoring engine v2 — computes volume/swaps from raw_events directly
 * Phase 4: fixed to use on-chain data instead of snapshot fields
 */
import { query } from "../db/index.js";
import scoringConfig from "../../config/scoring.json" with { type: "json" };
import { logger } from "../lib/logger.js";

type PoolScore = {
  poolId: number;
  protocol: string;
  poolAddress: string | null;
  token0: string;
  token1: string;
  fee: number | null;
  tickSpacing: number | null;
  hooks: string | null;
  score: number;
  confidence: number;
  riskLevel: "low" | "medium" | "high";
  riskFlags: string[];
  filters: { name: string; passed: boolean; reason?: string }[];
};

const weights = scoringConfig.weights as Record<string, number>;
const confidenceMults = scoringConfig.confidenceMultipliers as Record<string, number>;
const hardFilters = scoringConfig.hardFilters as Record<string, number | boolean>;

export async function evaluatePool(poolId: number): Promise<PoolScore | null> {
  const filters: PoolScore["filters"] = [];
  const riskFlags: string[] = [];

  try {
    const { rows: pools } = await query(`
      SELECT p.*,
        COALESCE(ps.tvl_usd, 0) as tvl_usd,
        COALESCE(ps.price_token1_per_token0, 0) as price_token1_per_token0,
        COALESCE(ps.current_tick, 0) as current_tick,
        COALESCE(ps.fee_apr_gross, 0) as fee_apr_gross,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(p.created_at, NOW()))) / 60 as age_minutes
      FROM pools p
      LEFT JOIN LATERAL (
        SELECT * FROM pool_snapshots 
        WHERE pool_db_id = p.id 
        ORDER BY time DESC LIMIT 1
      ) ps ON true
      WHERE p.id = $1
    `, [poolId]);

    if (pools.length === 0) return null;
    const p = pools[0];
    if (!p) return null;

    const poolAgeMin = Number(p.age_minutes ?? 0);
    const tvl = Number(p.tvl_usd ?? 0);

    // ── REAL data from raw_events ────────────────
    // Get swap counts and volume from on-chain events directly
    const { rows: stats } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE event_time >= NOW() - interval '24 hours') as swaps_24h,
        COUNT(*) FILTER (WHERE event_time >= NOW() - interval '7 days') as swaps_7d,
        MIN(event_time) as first_event,
        MAX(event_time) as last_event
      FROM raw_events re
      JOIN pools pp ON re.pool_ref = pp.pool_address
      WHERE pp.id = $1 AND re.event_name = 'Swap'
    `, [poolId]);

    const swaps24h = Number(stats[0]?.swaps_24h ?? 0);
    const swaps7d = Number(stats[0]?.swaps_7d ?? 0);
    const firstEvent = stats[0]?.first_event;
    const lastEvent = stats[0]?.last_event;

    // Estimate volume from swap events using decoded amounts
    let volume24hUsd = 0;
    if (swaps24h > 0) {
      // Sample up to 50 swaps for avg price, multiply by count
      const { rows: samples } = await query(`
        SELECT decoded FROM raw_events re
        JOIN pools pp ON re.pool_ref = pp.pool_address
        WHERE pp.id = $1
          AND re.event_name = 'Swap'
          AND re.event_time >= NOW() - interval '24 hours'
        ORDER BY RANDOM() LIMIT 50
      `, [poolId]);

      let totalQuote = 0;
      let totalBase = 0;
      for (const s of samples) {
        const d = s.decoded;
        // v3 format
        if (d.amount0 !== undefined && d.amount1 !== undefined) {
          totalBase += Math.abs(Number(d.amount0));
          totalQuote += Math.abs(Number(d.amount1));
        }
        // v2 format fallback
        if (totalBase === 0 && d.amount0In !== undefined) {
          totalBase += Number(d.amount0In) / 1e18 + Number(d.amount0Out ?? 0) / 1e18;
          totalQuote += Number(d.amount1In) / 1e18 + Number(d.amount1Out ?? 0) / 1e18;
        }
      }
      if (totalBase > 0 && totalQuote > 0) {
        const avgPrice = totalQuote / totalBase;
        const sampleBase = totalBase / Math.min(samples.length, 50);
        volume24hUsd = avgPrice * sampleBase * swaps24h;
      }
    }

    // Actual pool age from first event if created_at is unreliable
    const actualAgeMin = firstEvent
      ? Math.max(poolAgeMin, (Date.now() - new Date(firstEvent).getTime()) / 60000)
      : poolAgeMin;

    // --- HARD FILTERS ---
    const minAge = Number(hardFilters.minimumPoolAgeMinutes ?? 60);
    const minSwaps = Number(hardFilters.minimumSwapCount24h ?? 20);
    const minTraders = Number(hardFilters.minimumUniqueTraders24h ?? 8);
    const rejectV4Hooks = Boolean(hardFilters.rejectUnknownV4Hooks ?? true);

    // Filter 1: Pool age
    if (actualAgeMin < minAge) {
      filters.push({ name: "min_age", passed: false, reason: `${actualAgeMin.toFixed(0)}min < ${minAge}min required` });
    } else {
      filters.push({ name: "min_age", passed: true });
    }

    // Filter 2: Swap count
    if (swaps24h < minSwaps) {
      filters.push({ name: "min_swaps", passed: false, reason: `${swaps24h} < ${minSwaps} swaps/24h` });
    } else {
      filters.push({ name: "min_swaps", passed: true });
    }

    // Filter 3: Unique traders (estimate from event count as proxy)
    // Since we can't decode sender from raw events easily, use swaps24h as proxy
    if (swaps24h < minTraders) {
      filters.push({ name: "min_traders", passed: false, reason: `${swaps24h} events < ${minTraders} traders (proxy)` });
    } else {
      filters.push({ name: "min_traders", passed: true });
    }

    // Filter 4: v4 hooks reject
    if (p.protocol === "v4" && p.hooks && p.hooks !== "0x0000000000000000000000000000000000000000" && rejectV4Hooks) {
      filters.push({ name: "v4_hooks", passed: false, reason: `Unknown hooks: ${p.hooks}` });
      riskFlags.push("UNKNOWN_HOOKS");
    } else {
      filters.push({ name: "v4_hooks", passed: true });
    }

    // Check if any hard filter failed — soft fail: add risk flags, still score
    const failedFilters = filters.filter(f => !f.passed);
    for (const f of failedFilters) {
      riskFlags.push(f.name.toUpperCase());
    }

    // --- SCORE (0-100) ---
    let score = 0;
    let weightSum = 0;

    // Net fee opportunity (0-25 pts) — use estimated volume
    const feeApr = volume24hUsd > 0 && tvl > 0
      ? (volume24hUsd / tvl) * 365 * (Number(p.fee ?? 3000) / 1e6) * 100
      : 0;
    const feeScore = Math.min(25, (feeApr / 50) * 25);
    score += feeScore * (weights.netFeeOpportunity ?? 0.25);
    weightSum += (weights.netFeeOpportunity ?? 0.25);

    // Liquidity depth (0-20 pts)
    const liqScore = Math.min(20, Math.log10(tvl + 1) * 3);
    score += liqScore * (weights.liquidityDepth ?? 0.2);
    weightSum += (weights.liquidityDepth ?? 0.2);

    // Volume consistency (0-15 pts)
    const volScore = volume24hUsd > 10000 ? 15 : volume24hUsd > 1000 ? 10 : volume24hUsd > 100 ? 5 : 0;
    score += volScore * (weights.volumeConsistency ?? 0.15);
    weightSum += (weights.volumeConsistency ?? 0.15);

    // Volume-to-liquidity ratio (0-15 pts)
    const volLiqRatio = tvl > 0 ? volume24hUsd / tvl : 0;
    const volLiqScore = Math.min(15, volLiqRatio * 100);
    score += volLiqScore * (weights.stayInRangeProbability ?? 0.15);
    weightSum += (weights.stayInRangeProbability ?? 0.15);

    // IL risk (0-10 pts)
    const ilScore = Math.max(0, 10 - Math.abs(volLiqRatio * 5));
    score += ilScore * (weights.impermanentLossRisk ?? 0.1);
    weightSum += (weights.impermanentLossRisk ?? 0.1);

    // Safety (0-10 pts)
    const safetyScore = p.protocol === "v3" ? 8 : p.protocol === "v2" ? 5 : 7;
    score += safetyScore * (weights.tokenAndContractSafety ?? 0.1);
    weightSum += (weights.tokenAndContractSafety ?? 0.1);

    // Gas/rebalance (0-5 pts)
    const gasScore = p.protocol === "v3" ? 5 : p.protocol === "v4" ? 4 : 2;
    score += gasScore * (weights.gasAndRebalanceCost ?? 0.05);
    weightSum += (weights.gasAndRebalanceCost ?? 0.05);

    // Normalize
    if (weightSum > 0) score = score / weightSum;
    score = Math.round(Math.min(100, Math.max(0, score)));

    // --- CONFIDENCE ---
    let confMult = 1.0;
    if (actualAgeMin < 360) confMult = confidenceMults.historyLessThan6Hours ?? 0.45;
    else if (actualAgeMin < 1440) confMult = confidenceMults.history6To24Hours ?? 0.65;
    else if (actualAgeMin < 4320) confMult = confidenceMults.history1To3Days ?? 0.8;
    else if (actualAgeMin < 10080) confMult = confidenceMults.history3To7Days ?? 0.9;
    else confMult = confidenceMults.historyMoreThan7Days ?? 1.0;

    const confidence = Math.round(score * confMult);

    // --- RISK LEVEL ---
    let riskLevel: "low" | "medium" | "high" = "medium";
    if (score >= 70 && confidence >= 50) riskLevel = "low";
    else if (score < 40 || confidence < 30) riskLevel = "high";

    if (volume24hUsd < 100) riskFlags.push("LOW_VOLUME");
    if (tvl < 1000) riskFlags.push("LOW_LIQUIDITY");
    if (actualAgeMin < 360) riskFlags.push("YOUNG_POOL");

    return {
      poolId, protocol: p.protocol, poolAddress: p.pool_address,
      token0: p.token0, token1: p.token1,
      fee: p.fee, tickSpacing: p.tick_spacing, hooks: p.hooks,
      score, confidence, riskLevel, riskFlags, filters,
    };
  } catch (err) {
    logger.error(`[Scoring] evaluatePool(${poolId}) error: ${err}`);
    return null;
  }
}

export async function getTopPools(limit = 10, minScore = 65): Promise<PoolScore[]> {
  const { rows: poolIds } = await query<{ id: number }>(
    "SELECT id FROM pools WHERE status IN ('discovered', 'active') ORDER BY id"
  );

  const results: PoolScore[] = [];
  for (const { id } of poolIds) {
    const result = await evaluatePool(id);
    if (result && result.score >= minScore) {
      results.push(result);
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function updatePoolStatuses(): Promise<{ active: number; rejected: number }> {
  const { rows: poolIds } = await query<{ id: number }>(
    "SELECT id FROM pools WHERE status = 'discovered'"
  );
  let active = 0;
  let rejected = 0;

  for (const { id } of poolIds) {
    const result = await evaluatePool(id);
    if (result && result.score > 0) {
      await query("UPDATE pools SET status = 'active', rejection_reasons = '[]'::jsonb WHERE id = $1", [id]);
      active++;
    } else {
      const reasons = result?.filters.filter(f => !f.passed).map(f => f.reason || f.name) ?? ["No data"];
      await query("UPDATE pools SET status = 'active', rejection_reasons = $2::jsonb WHERE id = $1",
        [id, JSON.stringify(reasons)]);
      active++; // still mark active — degen mode
    }
  }

  return { active, rejected };
}
