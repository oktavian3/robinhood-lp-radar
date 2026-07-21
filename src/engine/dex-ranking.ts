/**
 * DEX-based ranking engine — ranks pools by real volume, TVL, APR from DEX Screener.
 * Uses BATCH search endpoint (1 API call for all Robinhood pools) instead of per-pool fetches.
 * 
 * Uses server-side result caching with 5-minute TTL so API calls are fast.
 */
import { query } from "../db/index.js";
import { computeApr } from "../lib/dex-volume.js";
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
let refreshPromise: Promise<void> | null = null;

/**
 * Get top N pools ranked by DEX Screener data.
 * Fast: returns cached results instantly (refreshed in background).
 */
export async function getDexRankedPools(limit = 10): Promise<DexRankedPool[]> {
  const now = Date.now();
  
  // Return cache if fresh
  if (cachedResult && (now - lastCacheTime) < CACHE_TTL_MS) {
    return cachedResult.slice(0, limit);
  }
  
  // Trigger background refresh if not already running
  if (!refreshPromise) {
    refreshPromise = refreshDexCache().finally(() => { refreshPromise = null; });
  }
  
  // Return stale cache while refreshing
  if (cachedResult && cachedResult.length > 0) {
    return cachedResult.slice(0, limit);
  }
  
  // First ever call — wait for refresh (max 30s)
  if (refreshPromise) {
    try {
      await Promise.race([
        refreshPromise,
        new Promise(r => setTimeout(r, 30000))
      ]);
    } catch { /* ignore */ }
  }
  return (cachedResult ?? []).slice(0, limit);
}

/**
 * Fetch ALL Robinhood Chain pools from DEX Screener in a single API call.
 * Then match them to our DB pools by pool_address.
 */
async function refreshDexCache(): Promise<void> {
  try {
    // 1. Get all pools from our DB
    const { rows: dbPools } = await query(`
      SELECT id, protocol, pool_address, pool_id, token0, token1, fee, tick_spacing, hooks
      FROM pools
      WHERE status IN ('discovered', 'active')
      ORDER BY id ASC
    `);

    if (dbPools.length === 0) {
      cachedResult = [];
      lastCacheTime = Date.now();
      return;
    }

    logger.info(`[DexRanking] Fetching DEX Screener batch data for ${dbPools.length} pools...`);

    // 2. Fetch ALL Robinhood pools from DEX Screener in 1 call
    const dexRes = await fetch(
      "https://api.dexscreener.com/latest/dex/search?q=robinhood",
      { signal: AbortSignal.timeout(15000) }
    );
    
    if (!dexRes.ok) {
      logger.warn(`[DexRanking] DEX Screener batch HTTP ${dexRes.status}`);
      if (cachedResult) return; // keep stale cache
      cachedResult = [];
      lastCacheTime = Date.now();
      return;
    }

    const dexBody = await dexRes.json();
    const allPairs: any[] = (dexBody?.pairs || []).filter(
      (p: any) => p.chainId === 'robinhood'
    );

    // 3. Build map: pool_address (lowercase) → DEX data
    const dexByAddress = new Map<string, any>();
    const dexByUrl = new Map<string, any>();
    
    for (const pair of allPairs) {
      const addr = (pair.pairAddress || '').toLowerCase();
      if (addr) dexByAddress.set(addr, pair);
      
      // Also index by URL-extracted address (DEX Screener sometimes changes address casing)
      const url = pair.url || '';
      const urlMatch = url.match(/\/robinhood\/(0x[a-f0-9]+)/i);
      if (urlMatch) dexByUrl.set(urlMatch[1].toLowerCase(), pair);
    }

    logger.info(`[DexRanking] DEX Screener returned ${allPairs.length} Robinhood pairs, ${dexByAddress.size} indexed by address`);

    // 4. Enrich our pools with DEX data
    // HYBRID approach:
    //   A) Batch match — pools found in DEX Screener search results (free, instant)
    //   B) Per-pool fallback — pools NOT found, fetch via per-pair endpoint (rate-limited)
    const effectiveFee = 3000; // default 0.3% for pools without fee data (3000/1e6 = 0.003)
    const enriched: DexRankedPool[] = [];
    const needsPerPool: typeof dbPools = [];

    for (const p of dbPools) {
      const lookupKey = (p.protocol === 'v4' && p.pool_id)
        ? String(p.pool_id) : (p.pool_address || '').toLowerCase();
      
      let dexData = dexByAddress.get(lookupKey) || dexByUrl.get(lookupKey);
      
      // For v4 pools, try matching by token addresses
      if (!dexData && p.protocol === 'v4' && p.pool_id) {
        for (const pair of allPairs) {
          const baseAddr = (pair.baseToken?.address || '').toLowerCase();
          const quoteAddr = (pair.quoteToken?.address || '').toLowerCase();
          const pToken0 = (p.token0 || '').toLowerCase();
          const pToken1 = (p.token1 || '').toLowerCase();
          if ((baseAddr === pToken0 && quoteAddr === pToken1) ||
              (baseAddr === pToken1 && quoteAddr === pToken0)) {
            dexData = pair;
            break;
          }
        }
      }

      if (!dexData && p.pool_address) {
        needsPerPool.push(p); // queue for per-pool fetch
        continue;
      }

      // Parse DEX data
      const vol = dexData ? (dexData.volume?.h24 ?? 0) : 0;
      const tvl = dexData ? (dexData.liquidity?.usd ?? 0) : 0;
      const fee = p.fee ?? effectiveFee;
      const apr = (vol > 0 && tvl > 0) ? computeApr(vol, fee, tvl) : null;

      let score = 0;
      if (apr !== null && apr > 0) {
        score = Math.min(50, Math.round(apr / 2));
      } else if (vol > 0) {
        score = Math.min(30, Math.round(vol / 1000));
      }
      if (tvl >= 1000) score += 10;
      else if (tvl >= 100) score += 5;
      if (p.protocol === "v3") score += 5;

      const riskFlags: string[] = [];
      if (vol < 100) riskFlags.push("LOW_VOLUME");
      if (tvl < 1000) riskFlags.push("LOW_LIQUIDITY");
      if (apr === null || apr === 0) riskFlags.push("NO_APR_DATA");

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
        price_usd: dexData?.priceUsd ? parseFloat(dexData.priceUsd) : null,
        price_change_24h: dexData?.priceChange?.h24 ?? null,
        price_change_6h: dexData?.priceChange?.h6 ?? null,
        base_token_symbol: dexData?.baseToken?.symbol ?? null,
        quote_token_symbol: dexData?.quoteToken?.symbol ?? null,
        txns_24h: dexData ? (dexData.txns?.h24?.buys ?? 0) + (dexData.txns?.h24?.sells ?? 0) : null,
        boosts: dexData?.boosts?.active ?? null,
        dex_txns_24h: dexData?.txns?.h24 ?? null,
      });
    }

    // 4B. Per-pool fallback for pools not in batch search results
    if (needsPerPool.length > 0) {
      logger.info(`[DexRanking] Fallback per-pool fetch for ${needsPerPool.length} pools...`);
      const { fetchPoolDexData } = await import("../lib/dex-volume.js");
      
      // Only process pools that have volume potential (skip ones with no pool_address)
      const candidates = needsPerPool.slice(0, 30); // max 30 to stay within rate limits
      
      for (const p of candidates) {
        const lookupKey = p.pool_address;
        if (!lookupKey) continue;
        
        try {
          const dexData = await fetchPoolDexData(lookupKey);
          const vol = dexData?.volume24hUsd ?? 0;
          const tvl = dexData?.tvlUsd ?? 0;
          const fee = p.fee ?? effectiveFee;
          const apr = (vol > 0 && tvl > 0) ? computeApr(vol, fee, tvl) : null;

          let score = 0;
          if (apr !== null && apr > 0) score = Math.min(50, Math.round(apr / 2));
          else if (vol > 0) score = Math.min(30, Math.round(vol / 1000));
          if (tvl >= 1000) score += 10;
          else if (tvl >= 100) score += 5;
          if (p.protocol === "v3") score += 5;

          const riskFlags: string[] = [];
          if (vol < 100) riskFlags.push("LOW_VOLUME");
          if (tvl < 1000) riskFlags.push("LOW_LIQUIDITY");
          if (apr === null || apr === 0) riskFlags.push("NO_APR_DATA");

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
        } catch (err) {
          logger.debug(`[DexRanking] Per-pool fetch failed for ${lookupKey}: ${err}`);
        }
        
        // Rate limit: 250ms between per-pool calls
        await new Promise(r => setTimeout(r, 250));
      }
      logger.info(`[DexRanking] Per-pool fallback complete: ${candidates.length} pools checked`);
    }

    // 5. Sort: practicality first
    // Weighted score: penalize tiny TVL pools, reward volume+TVL combo
    enriched.sort((a, b) => {
      const aTvl = a.tvl_usd ?? 0;
      const bTvl = b.tvl_usd ?? 0;
      const aVol = a.volume_24h ?? 0;
      const bVol = b.volume_24h ?? 0;
      
      // Filter out pools with TVL < $2k (micro-cap)
      // They rank below any pool with meaningful TVL
      if (aTvl < 2000 && bTvl >= 2000) return 1;
      if (bTvl < 2000 && aTvl >= 2000) return -1;
      
      // Primary: TVL × Volume (liquidity score) — rewards both size AND activity
      const aLiqScore = Math.log10(aTvl * Math.max(aVol, 1) + 1);
      const bLiqScore = Math.log10(bTvl * Math.max(bVol, 1) + 1);
      if (Math.abs(aLiqScore - bLiqScore) > 0.1) return bLiqScore - aLiqScore;
      
      // Secondary: APR
      const aprDiff = (b.apr_pct ?? 0) - (a.apr_pct ?? 0);
      if (aprDiff !== 0) return aprDiff;
      
      // Tertiary: TVL desc
      return bTvl - aTvl;
    });

    cachedResult = enriched;
    lastCacheTime = Date.now();
    const top = enriched[0];
    logger.info(`[DexRanking] Batch refresh: ${enriched.length} pools, #1=${top?.base_token_symbol || '?'}/${top?.quote_token_symbol || '?'} APR=${top?.apr_pct}% TVL=$${top?.tvl_usd}`);

  } catch (err) {
    logger.error(`[DexRanking] Batch refresh error: ${err}`);
    if (!cachedResult) {
      cachedResult = [];
      lastCacheTime = Date.now();
    }
  }
}
