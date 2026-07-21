/**
 * DEX-based ranking engine — ranks pools by real volume, TVL, APR from DEX Screener.
 * For LP farming: APR is the primary metric.
 * 
 * Uses server-side result caching with 5-minute TTL so API calls are fast.
 * Background pre-warm: fetches DEX data for all active pools (takes ~30s first time).
 */
import { query } from "../db/index.js";
import { fetchPoolDexData, computeApr } from "../lib/dex-volume.js";
import { logger } from "../lib/logger.js";

export type DexRankedPool = {
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
  volume_24h: number | null;
  tvl_usd: number | null;
  apr_pct: number | null;
  fdv_usd: number | null;
  market_cap: number | null;
  price_usd: number | null;
  price_change_24h: number | null;
  price_change_6h: number | null;
  base_token_symbol: string | null;
  quote_token_symbol: string | null;
  txns_24h: number | null;
  boosts: number | null;
  dex_txns_24h: { buys: number; sells: number } | null;
};

// ── Server-side cache ──────────────────────────────────
let cachedResult: DexRankedPool[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 300_000; // 5 minutes
let prewarmPromise: Promise<void> | null = null;

/**
 * Get top N pools ranked by DEX Screener data.
 * Fast: returns cached results instantly (refreshed in background).
 */
export async function getDexRankedPools(limit = 10): Promise<DexRankedPool[]> {
  const now = Date.now();
  
  // Return cache if fresh AND has enough data
  if (cachedResult && (now - lastCacheTime) < CACHE_TTL_MS) {
    return cachedResult.slice(0, limit);
  }
  
  // If cache expired or empty, trigger pre-warm (non-blocking)
  if (!prewarmPromise) {
    prewarmPromise = prewarmDexCache().finally(() => { prewarmPromise = null; });
  }
  
  // Return stale cache while pre-warming, but only if we have enough data
  if (cachedResult && cachedResult.length >= 10) {
    return cachedResult.slice(0, limit);
  }
  
  // First ever call — wait for at least some data
  if (prewarmPromise) {
    try {
      await Promise.race([
        prewarmPromise,
        new Promise(r => setTimeout(r, 30000)) // max 30s wait
      ]);
    } catch { /* ignore */ }
  }
  return (cachedResult ?? []).slice(0, limit);
}

/**
 * Background pre-warm: fetches DEX data for all active pools.
 * ~30-50s for 200 pools at 250ms intervals, but cache fills progressively.
 */
async function prewarmDexCache(): Promise<void> {
  try {
    const { rows: pools } = await query(`
      SELECT id, protocol, pool_address, pool_id, token0, token1, fee, tick_spacing, hooks
      FROM pools
      WHERE status IN ('discovered', 'active')
      ORDER BY id ASC
    `);

    if (pools.length === 0) {
      cachedResult = [];
      lastCacheTime = Date.now();
      return;
    }

    logger.info(`[DexRanking] Fetching DEX data for ${pools.length} pools (incl. v4)...`);

    // Process newer pools first (v4, higher IDs tend to have more volume)
    pools.reverse();

    // Process in batches: first 20 immediately, then rest with 100ms delay
    const batchSize = 20;
    const enriched: DexRankedPool[] = [];

    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      // v2/v3 use pool_address, v4 uses pool_id
      const lookupKey = (p.protocol === 'v4' && p.pool_id) ? p.pool_id : p.pool_address;
      if (!lookupKey) continue; // skip pools with no identifier

      // Default fee for pools without fee data (Uniswap default: 0.30% = 3000 bps)
      const effectiveFee = p.fee ?? 3000;

      const dexData = await fetchPoolDexData(lookupKey);
      
      const apr = dexData ? computeApr(dexData.volume24hUsd, effectiveFee, dexData.tvlUsd) : null;
      const vol = dexData?.volume24hUsd ?? 0;
      const tvl = dexData?.tvlUsd ?? 0;

      // Compute score
      let score = 0;
      if (apr !== null && apr > 0) {
        score = Math.min(50, Math.round(apr / 2));
      } else if (vol > 0) {
        score = Math.min(30, Math.round(vol / 1000));
      }
      if (tvl >= 1000) score += 10;
      else if (tvl >= 100) score += 5;
      if (p.protocol === "v3") score += 5;

      // Risk flags
      const riskFlags: string[] = [];
      if (vol < 100) riskFlags.push("LOW_VOLUME");
      if (tvl < 1000) riskFlags.push("LOW_LIQUIDITY");
      if (apr === null || apr === 0) riskFlags.push("NO_APR_DATA");

      // Confidence
      const confidence = Math.min(100, Math.round(
        20 + (vol > 10000 ? 40 : vol > 1000 ? 25 : vol > 100 ? 10 : 0) +
        (tvl > 10000 ? 20 : tvl > 1000 ? 15 : tvl > 100 ? 5 : 0) +
        (apr !== null && apr > 0 ? 20 : 0)
      ));

      let riskLevel: "low" | "medium" | "high" = "high";
      if (confidence >= 60 && tvl >= 10000) riskLevel = "low";
      else if (confidence >= 30) riskLevel = "medium";

      enriched.push({
        poolId: p.id, protocol: p.protocol, poolAddress: p.pool_address,
        token0: p.token0, token1: p.token1,
        fee: p.fee, tickSpacing: p.tick_spacing, hooks: p.hooks,
        score: Math.min(100, score), confidence, riskLevel, riskFlags,
        volume_24h: vol > 0 ? vol : null,
        tvl_usd: tvl > 0 ? tvl : null, apr_pct: apr,
        fdv_usd: dexData?.fdv ?? null,
        market_cap: dexData?.marketCap ?? null,
        price_usd: dexData?.priceUsd ?? null,
        price_change_24h: dexData?.priceChange?.h24 ?? null,
        price_change_6h: dexData?.priceChange?.h6 ?? null,
        base_token_symbol: dexData?.baseToken?.symbol ?? null,
        quote_token_symbol: dexData?.quoteToken?.symbol ?? null,
        txns_24h: dexData ? (dexData.txns24h.buys + dexData.txns24h.sells) : null,
        boosts: dexData?.boostsActive ?? null,
        dex_txns_24h: dexData?.txns24h ?? null,
      });

      // Every batch: update cache with partial results (progressive)
      if ((i + 1) % batchSize === 0 || i === pools.length - 1) {
        // Sort by APR desc → volume desc → TVL desc
        enriched.sort((a, b) => {
          const aprDiff = (b.apr_pct ?? 0) - (a.apr_pct ?? 0);
          if (aprDiff !== 0) return aprDiff;
          const volDiff = (b.volume_24h ?? 0) - (a.volume_24h ?? 0);
          if (volDiff !== 0) return volDiff;
          return (b.tvl_usd ?? 0) - (a.tvl_usd ?? 0);
        });

        cachedResult = [...enriched];
        lastCacheTime = Date.now();
        logger.info(`[DexRanking] Cache update: ${enriched.length} pools, #1 APR=${enriched[0]?.apr_pct}% vol=${enriched[0]?.volume_24h}`);
      }

      // Delay between requests
      await new Promise(r => setTimeout(r, 250)); // 250ms = 240 req/min (under 300 DEX rate limit)
    }

    logger.info(`[DexRanking] Pre-warm complete: ${enriched.length} pools ranked`);
  } catch (err) {
    logger.error(`[DexRanking] Pre-warm error: ${err}`);
    // Keep stale cache if exists
    if (!cachedResult) {
      cachedResult = [];
      lastCacheTime = Date.now();
    }
  }
}
