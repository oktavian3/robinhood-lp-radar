/**
 * Range Engine v1
 * Phase 3: volatility, candidate ranges, backtest, fee/IL/net estimation
 *
 * Math:
 *   lower = P × exp(-k × σ × √H)
 *   upper = P × exp(+k × σ × √H)
 */
import { query } from "../db/index.js";
import { logger } from "../lib/logger.js";
import Decimal from "decimal.js";

// ─── Types ───────────────────────────────────────────

export type StrategyIntent = "EARN_FEES_AROUND_CURRENT_PRICE" | "BUY_TOKEN_BELOW" | "SELL_TOKEN_ABOVE";

export type RangeCandidate = {
  strategy: StrategyIntent;
  label: string;               // human label
  lowerPrice: number;
  upperPrice: number;
  tickLower: number;
  tickUpper: number;
  depositAsset: string;        // token address of deposit asset
  depositRatio: [number, number]; // [token0 ratio, token1 ratio]
  k: number;                   // volatility multiplier used
};

export type RangeResult = {
  candidate: RangeCandidate;
  // Volatility
  realizedVol24h: number;
  realizedVol7d: number | null;
  atr: number;
  // Backtest
  timeInRangePct: number;
  medianTimeToExitHours: number | null;
  reentryCount: number;
  maxDrawdown: number;
  // Probabilities
  prob12h: number;
  prob24h: number;
  prob3d: number | null;
  prob7d: number | null;
  sampleSize: number;
  // Fee/IL/Net
  estimatedGrossFeesUsd: number;
  estimatedIlUsd: number;
  estimatedGasUsd: number;
  estimatedNetUsd: number;
  estimatedNetVsHoldPct: number;
  estimatedDurationHours: [number, number]; // [low, high]
  confidence: number;
};

// ─── Volatility ──────────────────────────────────────

function logReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > 0 && prices[i - 1] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return returns;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sq = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(sq / (values.length - 1));
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * pct);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function calcVolatility(closes: number[], period = 288): {
  realizedVol24h: number;
  realizedVol7d: number | null;
  atr: number;
  maxDrawdown: number;
  jumpFrequency: number;
} {
  const recent = closes.slice(-period);
  const returns = logReturns(recent);
  const dailyReturns = logReturns(
    closes.filter((_, i) => i % 12 === 0) // approximate daily from 5m candles
  );

  const rv24h = stdDev(returns) * Math.sqrt(288); // 288 * 5min = 24h
  const rv7d = dailyReturns.length > 5 ? stdDev(dailyReturns) * Math.sqrt(365) : null;

  // ATR
  let atr = 0;
  if (recent.length > 1) {
    const ranges: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      ranges.push(Math.abs(recent[i] - recent[i - 1]));
    }
    atr = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  }

  // Max drawdown
  let peak = recent[0];
  let maxDd = 0;
  for (const p of recent) {
    if (p > peak) peak = p;
    const dd = (peak - p) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  return {
    realizedVol24h: rv24h || 0.01,
    realizedVol7d: rv7d || null,
    atr: atr || 0.001,
    maxDrawdown: maxDd || 0,
    jumpFrequency: 0,
  };
}

// ─── Tick Conversion ─────────────────────────────────

export function priceToSqrtPrice(price: number, decimals0 = 18, decimals1 = 18): bigint {
  const adjusted = new Decimal(price)
    .times(new Decimal(10).pow(decimals1))
    .div(new Decimal(10).pow(decimals0));
  if (adjusted.lte(0)) return 0n;
  const sqrt = Decimal.sqrt(adjusted);
  return BigInt(Math.floor(Number(sqrt) * 2 ** 96));
}

export function sqrtPriceToTick(sqrtPriceX96: bigint): number {
  const price = Number(sqrtPriceX96) / 2 ** 96;
  const tick = Math.log(price) / Math.log(1.0001);
  return Math.round(tick);
}

export function tickToPrice(tick: number): number {
  return 1.0001 ** tick;
}

export function roundTickToSpacing(tick: number, spacing: number, roundDown: boolean): number {
  if (!spacing || spacing <= 0) return tick;
  const remainder = ((tick % spacing) + spacing) % spacing;
  if (roundDown) return tick - remainder;
  return remainder === 0 ? tick : tick + (spacing - remainder);
}

export function convertRange(
  lowerPrice: number,
  upperPrice: number,
  token0: string,
  token1: string,
  tickSpacing: number,
  decimals0 = 18,
  decimals1 = 18
): { tickLower: number; tickUpper: number; lowerPriceAdj: number; upperPriceAdj: number } {
  // Convert price to tick via sqrtPrice
  const sqrtLower = priceToSqrtPrice(lowerPrice, decimals0, decimals1);
  const sqrtUpper = priceToSqrtPrice(upperPrice, decimals0, decimals1);
  let tickLower = sqrtPriceToTick(sqrtLower);
  let tickUpper = sqrtPriceToTick(sqrtUpper);

  // Ensure lower < upper
  if (tickLower >= tickUpper) {
    [tickLower, tickUpper] = [tickUpper, tickLower];
  }

  // Round to tick spacing
  tickLower = roundTickToSpacing(tickLower, tickSpacing, true);
  tickUpper = roundTickToSpacing(tickUpper, tickSpacing, false);

  return {
    tickLower,
    tickUpper,
    lowerPriceAdj: tickToPrice(tickLower),
    upperPriceAdj: tickToPrice(tickUpper),
  };
}

// ─── Candidate Generation ────────────────────────────

export function generateCandidates(
  currentPrice: number,
  realizedVol24h: number,
  currentTick: number,
  tickSpacing: number,
  token0: string,
  token1: string,
  decimals0 = 18,
  decimals1 = 18
): RangeCandidate[] {
  const candidates: RangeCandidate[] = [];
  const H = 24; // 24h lookback for volatility
  const sigma = realizedVol24h;

  // Common tick spacings for Robinhood/Uniswap v3
  const spacing = tickSpacing || 10;

  // Active ranges: EARN FEES AROUND CURRENT PRICE
  // k values: narrow=0.5, balanced=1.0, wide=2.0
  const activeConfigs = [
    { k: 0.5, label: "Narrow (55-70%ile)", strategy: "EARN_FEES_AROUND_CURRENT_PRICE" as StrategyIntent },
    { k: 1.0, label: "Balanced (75-88%ile)", strategy: "EARN_FEES_AROUND_CURRENT_PRICE" as StrategyIntent },
    { k: 2.0, label: "Wide (90-97%ile)", strategy: "EARN_FEES_AROUND_CURRENT_PRICE" as StrategyIntent },
  ];

  for (const cfg of activeConfigs) {
    const range = sigma * cfg.k * Math.sqrt(H);
    const lower = currentPrice * Math.exp(-range);
    const upper = currentPrice * Math.exp(range);

    const converted = convertRange(lower, upper, token0, token1, spacing, decimals0, decimals1);

    candidates.push({
      strategy: cfg.strategy,
      label: cfg.label,
      lowerPrice: converted.lowerPriceAdj,
      upperPrice: converted.upperPriceAdj,
      tickLower: converted.tickLower,
      tickUpper: converted.tickUpper,
      depositAsset: token0,
      depositRatio: [0.5, 0.5], // balanced deposit for active ranges
      k: cfg.k,
    });
  }

  // One-sided: BUY TOKEN BELOW
  const buyBelowK = 1.5;
  const belowRange = sigma * buyBelowK * Math.sqrt(H);
  const buyLower = currentPrice * Math.exp(-belowRange * 1.5);
  const buyUpper = currentPrice * Math.exp(-belowRange * 0.2);
  const buyConverted = convertRange(buyLower, buyUpper, token0, token1, spacing, decimals0, decimals1);

  candidates.push({
    strategy: "BUY_TOKEN_BELOW",
    label: "Buy Token Below",
    lowerPrice: buyConverted.lowerPriceAdj,
    upperPrice: buyConverted.upperPriceAdj,
    tickLower: buyConverted.tickLower,
    tickUpper: buyConverted.tickUpper,
    depositAsset: token1, // deposit quote asset
    depositRatio: [0, 1], // 100% token1
    k: buyBelowK,
  });

  // One-sided: SELL TOKEN ABOVE
  const sellAboveK = 1.5;
  const aboveRange = sigma * sellAboveK * Math.sqrt(H);
  const sellLower = currentPrice * Math.exp(aboveRange * 0.2);
  const sellUpper = currentPrice * Math.exp(aboveRange * 1.5);
  const sellConverted = convertRange(sellLower, sellUpper, token0, token1, spacing, decimals0, decimals1);

  candidates.push({
    strategy: "SELL_TOKEN_ABOVE",
    label: "Sell Token Above",
    lowerPrice: sellConverted.lowerPriceAdj,
    upperPrice: sellConverted.upperPriceAdj,
    tickLower: sellConverted.tickLower,
    tickUpper: sellConverted.tickUpper,
    depositAsset: token0, // deposit base token
    depositRatio: [1, 0], // 100% token0
    k: sellAboveK,
  });

  return candidates;
}

// ─── Backtester ──────────────────────────────────────

export function runBacktest(
  closes: number[],
  timestamps: Date[],
  lowerPrice: number,
  upperPrice: number
): {
  timeInRangePct: number;
  medianTimeToExitHours: number | null;
  reentryCount: number;
  probWindows: Record<string, number>;
} {
  if (closes.length < 2) {
    return { timeInRangePct: 0, medianTimeToExitHours: null, reentryCount: 0, probWindows: {} };
  }

  // For each price point, check if in range
  const inRange = closes.map((p) => p >= lowerPrice && p <= upperPrice);
  const inRangeCount = inRange.filter(Boolean).length;
  const timeInRangePct = (inRangeCount / inRange.length) * 100;

  // Find exit events (consecutive out-of-range)
  let inRangeCurrently = true;
  let exitDurations: number[] = [];
  let reentries = 0;
  let lastEntryIdx = 0;

  for (let i = 0; i < inRange.length; i++) {
    if (inRange[i] && !inRangeCurrently) {
      reentries++;
      inRangeCurrently = true;
      lastEntryIdx = i;
    } else if (!inRange[i] && inRangeCurrently) {
      inRangeCurrently = false;
      if (lastEntryIdx > 0 && timestamps[lastEntryIdx] && timestamps[i]) {
        const hours = (timestamps[i].getTime() - timestamps[lastEntryIdx].getTime()) / 3600000;
        if (hours > 0) exitDurations.push(hours);
      }
    }
  }

  // Median time to exit
  exitDurations.sort((a, b) => a - b);
  const medianTimeToExitHours = exitDurations.length > 0
    ? exitDurations[Math.floor(exitDurations.length / 2)]
    : null;

  // Window probabilities
  const windowSize = 5 * 60 * 1000; // 5 min per candle
  const probWindows: Record<string, number> = {};

  for (const [label, candles] of Object.entries({
    "12h": 144, "24h": 288, "3d": 864, "7d": 2016,
  })) {
    if (closes.length >= candles) {
      const recentInRange = closes.slice(-candles).filter(
        (p) => p >= lowerPrice && p <= upperPrice
      ).length;
      probWindows[label] = recentInRange / candles;
    }
  }

  return { timeInRangePct, medianTimeToExitHours, reentryCount: reentries, probWindows };
}

// ─── Fee Estimation ──────────────────────────────────

export function estimateFees(
  tvlUsd: number,
  volume24hUsd: number,
  fee: number,                // in basis points (e.g., 500 = 5%, 100 = 1%)
  timeInRangePct: number,
  positionSharePct: number     // estimated share of liquidity
): number {
  if (tvlUsd <= 0 || volume24hUsd <= 0) return 0;
  const feeRate = fee / 1_000_000; // convert basis points to decimal (500 = 0.05%)
  const dailyFeePool = volume24hUsd * feeRate;
  const positionDailyFee = dailyFeePool * (positionSharePct / 100);
  // Adjust for time in range
  return positionDailyFee * (timeInRangePct / 100);
}

export function estimateImpermanentLoss(
  priceChangePct: number,
  depositRatio: [number, number]
): number {
  // Simplified IL: for a balanced position, IL ≈ (√(P) - 1)² / 2√(P) * capital
  // where P = (1 + priceChangePct)
  if (depositRatio[0] === 0 || depositRatio[1] === 0) return 0; // single-sided = no IL

  const k = priceChangePct / 100;
  const sqrtP = Math.sqrt(Math.abs(1 + k)) * (k >= 0 ? 1 : -1);
  // Approximate IL formula
  const il = 2 * Math.sqrt(1 + k) / (1 + (1 + k)) - 1;
  return Math.abs(il);
}

// ─── Full Range Evaluation ───────────────────────────

export async function evaluateRangeForPool(
  poolId: number,
  capitalUsd = 10_000
): Promise<RangeResult[]> {
  try {
    // Load candles
    const { rows: candles } = await query(
      `SELECT bucket, close, volume_usd, trade_count
       FROM candles_5m
       WHERE pool_db_id = $1 AND source = 'indexer'
       ORDER BY bucket ASC`,
      [poolId]
    );

    // Load pool + snapshot
    const { rows: pools } = await query(`
      SELECT p.*, ps.current_tick, ps.tvl_usd, ps.volume_24h_usd, ps.active_liquidity
      FROM pools p
      LEFT JOIN LATERAL (
        SELECT * FROM pool_snapshots WHERE pool_db_id = p.id ORDER BY time DESC LIMIT 1
      ) ps ON true
      WHERE p.id = $1
    `, [poolId]);

    if (pools.length === 0 || candles.length < 2) return [];
    const pool = pools[0];

    const closes = candles.map((c: any) => Number(c.close));
    const timestamps = candles.map((c: any) => new Date(c.bucket));
    const lastClose = closes[closes.length - 1] || 0;

    // Sanity check: if candle close prices are all unrealistically small
    // (e.g., < 1e-10 despite both tokens having standard decimals), use tick price instead
    let currentPrice: number;
    const medianClose = [...closes].sort((a, b) => a - b)[Math.floor(closes.length / 2)];
    if (medianClose > 0 && medianClose < 1e-10) {
      // Candle prices are garbage — compute from pool tick if available
      if (pool.current_tick !== null && pool.current_tick !== undefined) {
        const tick = Number(pool.current_tick);
        if (tick !== 0) {
          currentPrice = Math.pow(1.0001, Number(pool.current_tick));
          logger.warn(`[RangeEngine] pool ${poolId}: candle price ${medianClose} too small, using tick price ${currentPrice}`);
        } else {
          currentPrice = lastClose || 0.001;
        }
      } else {
        currentPrice = lastClose || 0.001;
      }
    } else {
      currentPrice = lastClose || 0.001;
    }
    const tvl = Number(pool.tvl_usd ?? 1000);
    const vol24h = Number(pool.volume_24h_usd ?? 0);
    const currentTick = Number(pool.current_tick ?? 0);
    const tickSpacing = Number(pool.tick_spacing ?? 10);
    const fee = Number(pool.fee ?? 500);
    const token0 = pool.token0;
    const token1 = pool.token1;

    if (currentPrice <= 0) return [];

    // 1. Volatility
    const vol = calcVolatility(closes);

    // 2. Generate candidates
    const candidates = generateCandidates(
      currentPrice, vol.realizedVol24h, currentTick, tickSpacing, token0, token1
    );

    // 3. Evaluate each candidate
    const results: RangeResult[] = [];

    for (const cand of candidates) {
      // Backtest
      const bt = runBacktest(closes, timestamps, cand.lowerPrice, cand.upperPrice);

      // Position share estimate (naive: 1% of TVL)
      const positionSharePct = Math.min(1, (capitalUsd / (tvl || 1)) * 100);

      // Fees
      const grossFees = estimateFees(tvl, vol24h, fee, bt.timeInRangePct, positionSharePct);

      // IL
      const priceRange = (cand.upperPrice - cand.lowerPrice) / cand.lowerPrice;
      const il = estimateImpermanentLoss(priceRange * 100, cand.depositRatio);

      // Gas
      const estimatedGasUsd = 0.50; // fixed estimate for Robinhood Chain

      // Net
      const netUsd = grossFees - il * (capitalUsd * 0.01) - estimatedGasUsd;
      const netVsHoldPct = (netUsd / capitalUsd) * 100;

      // Duration estimate
      const durationLow = bt.medianTimeToExitHours
        ? Math.round(bt.medianTimeToExitHours * 0.5 * 10) / 10
        : 12;
      const durationHigh = bt.medianTimeToExitHours
        ? Math.round(bt.medianTimeToExitHours * 1.5 * 10) / 10
        : 48;

      // Confidence: based on sample size and volatility stability
      const confBase = Math.min(100, (candles.length / 288) * 50 + 30); // 288 = 24h of 5m candles
      const volStability = vol.realizedVol7d
        ? Math.max(0, 100 - Math.abs((vol.realizedVol24h - vol.realizedVol7d) / vol.realizedVol7d) * 50)
        : 50;
      const confidence = Math.round(Math.min(95, Math.max(5, confBase * 0.6 + volStability * 0.4)));

      results.push({
        candidate: cand,
        realizedVol24h: vol.realizedVol24h,
        realizedVol7d: vol.realizedVol7d,
        atr: vol.atr,
        timeInRangePct: bt.timeInRangePct,
        medianTimeToExitHours: bt.medianTimeToExitHours,
        reentryCount: bt.reentryCount,
        maxDrawdown: vol.maxDrawdown,
        prob12h: bt.probWindows["12h"] ?? 0.5,
        prob24h: bt.probWindows["24h"] ?? 0.3,
        prob3d: bt.probWindows["3d"] ?? null,
        prob7d: bt.probWindows["7d"] ?? null,
        sampleSize: candles.length,
        estimatedGrossFeesUsd: Math.round(grossFees * 100) / 100,
        estimatedIlUsd: Math.round(il * capitalUsd * 100) / 100,
        estimatedGasUsd,
        estimatedNetUsd: Math.round(netUsd * 100) / 100,
        estimatedNetVsHoldPct: Math.round(netVsHoldPct * 100) / 100,
        estimatedDurationHours: [durationLow, durationHigh],
        confidence,
      });
    }

    return results.sort((a, b) => b.estimatedNetUsd - a.estimatedNetUsd);
  } catch (err) {
    logger.error(`[RangeEngine] evaluatePool(${poolId}) error: ${err}`);
    return [];
  }
}
