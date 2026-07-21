/**
 * DEX Screener Trending Token Scanner untuk Robinhood Chain.
 * Menemukan top token trending + LP pools langsung dari DEX Screener.
 */
import { logger } from "../lib/logger.js";
import { query } from "../db/index.js";
import { fetchPoolDexData, computeApr, type DexPoolData } from "../lib/dex-volume.js";

export type TrendingToken = {
  tokenAddress: string;
  symbol: string;
  name: string;
  volume24hUsd: number;
  tvlUsd: number;
  mcap: number;
  priceUsd: number | null;
  priceChange24h: number | null;
  txns24h: number;
  pools: TrendingPool[];
  priority: number; // ranking
};

export type TrendingPool = {
  pairAddress: string;
  protocol: string;
  dexData: DexPoolData | null;
  fee: number | null;
  effectiveFee: number;
  apr: number | null;
  score: number;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
};

const KNOWN_HIGH_VOLUME_TOKENS = [
  "BRODIE", "PONS", "18932", "FOX", "CASH", "AVATROLL", "CLOCKIN",
  "DOGHOOD", "DANK", "MELON", "GNOCCHI", "THOTH", "AIXBT", "RANGE",
  "WAGMI", "SHIBBO", "HDX", "VIEM",
];

// Cache
let cachedTrending: TrendingToken[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 120_000; // 2 minutes

/**
 * Scan DEX Screener for top trending tokens on Robinhood
 */
export async function getTrendingTokens(limit = 15): Promise<TrendingToken[]> {
  const now = Date.now();
  if (cachedTrending && (now - lastCacheTime) < CACHE_TTL_MS) {
    return cachedTrending.slice(0, limit);
  }

  try {
    const tokens = await scanDexScreenerTokens();
    cachedTrending = tokens;
    lastCacheTime = Date.now();
    return tokens.slice(0, limit);
  } catch (err) {
    logger.error(`[Trending] Scan error: ${err}`);
    return cachedTrending?.slice(0, limit) ?? [];
  }
}

async function scanDexScreenerTokens(): Promise<TrendingToken[]> {
  // 1. Get boosted/trending tokens from DEX Screener
  const boostedTokens = await fetchBoostedTokens();
  
  // 2. Search for known high-volume tokens
  const knownTokens = await searchKnownTokens();
  
  // 3. Merge: boosted + known, dedup by address
  const tokenMap = new Map<string, TrendingToken>();
  
  for (const t of [...boostedTokens, ...knownTokens]) {
    const key = t.tokenAddress.toLowerCase();
    if (!tokenMap.has(key) || t.volume24hUsd > tokenMap.get(key)!.volume24hUsd) {
      tokenMap.set(key, t);
    }
  }

  // 4. Sort by volume descending
  const sorted = [...tokenMap.values()].sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  
  // 5. Assign priority
  sorted.forEach((t, i) => t.priority = i + 1);
  
  logger.info(`[Trending] Scanned ${sorted.length} tokens. Top: ${sorted[0]?.symbol} $${(sorted[0]?.volume24hUsd/1e6).toFixed(1)}M`);
  return sorted;
}

async function fetchBoostedTokens(): Promise<TrendingToken[]> {
  try {
    const res = await fetch("https://api.dexscreener.com/token-boosts/latest/v1", {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const boosts: any[] = await res.json();
    
    const rhBoosts = boosts.filter(b => b.chainId === "robinhood");
    const tokens: TrendingToken[] = [];
    
    for (const b of rhBoosts) {
      const addr = b.tokenAddress.toLowerCase();
      const pools = await findTokenPools(addr);
      
      // Get symbol from pools or from boosted data
      const symbol = pools.length > 0 ? pools[0].token0Symbol || pools[0].token1Symbol : addr.slice(0, 6);
      
      const totalVol = pools.reduce((s, p) => s + (p.dexData?.volume24hUsd ?? 0), 0);
      const totalTvl = pools.reduce((s, p) => s + (p.dexData?.tvlUsd ?? 0), 0);
      const maxMcap = Math.max(...pools.map(p => p.dexData?.marketCap ?? 0), 0);
      
      tokens.push({
        tokenAddress: addr,
        symbol,
        name: symbol,
        volume24hUsd: totalVol,
        tvlUsd: totalTvl,
        mcap: maxMcap,
        priceUsd: pools[0]?.dexData?.priceUsd ?? null,
        priceChange24h: pools[0]?.dexData?.priceChange?.h24 ?? null,
        txns24h: pools.reduce((s, p) => s + ((p.dexData?.txns24h.buys ?? 0) + (p.dexData?.txns24h.sells ?? 0)), 0),
        pools,
        priority: 0,
      });
      
      await new Promise(r => setTimeout(r, 250)); // rate limit
    }
    
    return tokens;
  } catch (err) {
    logger.warn(`[Trending] fetchBoostedTokens error: ${err}`);
    return [];
  }
}

async function searchKnownTokens(): Promise<TrendingToken[]> {
  const tokens: TrendingToken[] = [];
  
  for (const name of KNOWN_HIGH_VOLUME_TOKENS) {
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(name)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      
      const data = await res.json();
      const pairs: any[] = (data.pairs || []).filter((p: any) => p.chainId === "robinhood");
      if (pairs.length === 0) continue;
      
      // Collect unique token addresses
      const tokenAddrs = new Set<string>();
      for (const p of pairs) {
        tokenAddrs.add(p.baseToken?.address?.toLowerCase());
        tokenAddrs.add(p.quoteToken?.address?.toLowerCase());
      }
      
      // For each token address, find pools
      for (const addr of tokenAddrs) {
        if (!addr) continue;
        const pools = await findTokenPools(addr);
        if (pools.length === 0) continue;
        
        const totalVol = pools.reduce((s, p) => s + (p.dexData?.volume24hUsd ?? 0), 0);
        const totalTvl = pools.reduce((s, p) => s + (p.dexData?.tvlUsd ?? 0), 0);
        const maxMcap = Math.max(...pools.map(p => p.dexData?.marketCap ?? 0), 0);
        const symbol = pools[0]?.dexData?.baseToken?.symbol || pools[0]?.token0Symbol || name;
        
        // Skip if we already have this token (dedup)
        if (tokens.some(t => t.tokenAddress.toLowerCase() === addr)) continue;
        
        tokens.push({
          tokenAddress: addr,
          symbol,
          name: pools[0]?.dexData?.baseToken?.name || symbol,
          volume24hUsd: totalVol,
          tvlUsd: totalTvl,
          mcap: maxMcap,
          priceUsd: pools[0]?.dexData?.priceUsd ?? null,
          priceChange24h: pools[0]?.dexData?.priceChange?.h24 ?? null,
          txns24h: pools.reduce((s, p) => s + ((p.dexData?.txns24h.buys ?? 0) + (p.dexData?.txns24h.sells ?? 0)), 0),
          pools,
          priority: 0,
        });
      }
      
      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      logger.warn(`[Trending] searchKnownTokens error for ${name}: ${err}`);
    }
  }
  
  return tokens;
}

async function findTokenPools(tokenAddress: string): Promise<TrendingPool[]> {
  try {
    // Search DEX Screener for this token
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${tokenAddress}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    
    const data = await res.json();
    const pairs: any[] = (data.pairs || []).filter((p: any) => p.chainId === "robinhood");
    
    const pools: TrendingPool[] = [];
    
    for (const pair of pairs) {
      const pairAddr = pair.pairAddress?.toLowerCase();
      if (!pairAddr) continue;
      
      // Get detailed data
      const dexData = await fetchPoolDexData(pairAddr);
      if (!dexData) continue;
      
      const fee = pair.fee ?? null;
      const effectiveFee = fee ?? 3000;
      const apr = computeApr(dexData.volume24hUsd, effectiveFee, dexData.tvlUsd);
      
      // Score
      let score = 0;
      if (apr !== null && apr > 0) score = Math.min(50, Math.round(apr / 2));
      else if (dexData.volume24hUsd > 0) score = Math.min(30, Math.round(dexData.volume24hUsd / 1000));
      if (dexData.tvlUsd >= 1000) score += 10;
      
      const baseSym = pair.baseToken?.symbol || '';
      const quoteSym = pair.quoteToken?.symbol || '';
      
      pools.push({
        pairAddress: pairAddr,
        protocol: (pair.labels || ['v3'])[0] || 'v3',
        dexData,
        fee,
        effectiveFee,
        apr,
        score,
        token0: pair.baseToken?.address || '',
        token1: pair.quoteToken?.address || '',
        token0Symbol: baseSym,
        token1Symbol: quoteSym,
      });
    }
    
    // Sort by APR desc
    pools.sort((a, b) => (b.apr ?? 0) - (a.apr ?? 0));
    return pools;
  } catch (err) {
    logger.warn(`[Trending] findTokenPools error for ${tokenAddress.slice(0, 10)}: ${err}`);
    return [];
  }
}

/**
 * Import missing pools from trending data into our DB
 */
export async function importTrendingPools(tokens: TrendingToken[]): Promise<number> {
  let imported = 0;
  
  for (const token of tokens) {
    for (const pool of token.pools) {
      try {
        // Check if pool already exists
        const key = pool.pairAddress.toLowerCase();
        const { rows } = await query(
          `SELECT id FROM pools WHERE pool_address = $1 OR pool_id = $1`,
          [key]
        );
        
        if (rows.length === 0) {
          // Import new pool
          const isV4 = key.length > 50;
          await query(
            `INSERT INTO pools (chain_id, protocol, ${isV4 ? 'pool_id' : 'pool_address'}, token0, token1, fee, status, metadata)
             VALUES (4663, $1, $2, $3, $4, $5, 'discovered', $6::jsonb)
             ON CONFLICT (chain_id, protocol, COALESCE(pool_address, ''), COALESCE(pool_id, '')) DO NOTHING`,
            [
              isV4 ? 'v4' : 'v3',
              key,
              pool.token0,
              pool.token1,
              pool.fee ?? 3000,
              JSON.stringify({
                token0Symbol: pool.token0Symbol,
                token1Symbol: pool.token1Symbol,
                source: 'dexscreener-trending',
                volume24h: pool.dexData?.volume24hUsd,
                tvlUsd: pool.dexData?.tvlUsd,
              })
            ]
          );
          imported++;
        }
      } catch (err) {
        logger.warn(`[Trending] Import error for ${pool.pairAddress.slice(0, 15)}: ${err}`);
      }
    }
  }
  
  if (imported > 0) {
    logger.info(`[Trending] Imported ${imported} new pools from trending scan`);
  }
  return imported;
}
