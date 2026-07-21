/**
 * DEX Screener volume/liquidity fetcher for Robinhood Chain pools.
 * Returns 24h volume, TVL, and computed APR for pool addresses.
 * Now includes full DEX Screener fields: FDV, marketCap, price, priceChange, token info.
 */
import { logger } from "./logger.js";

const DEX_BASE = "https://api.dexscreener.com/latest/dex";
const CHAIN = "robinhood";

// In-memory cache with TTL
const cache = new Map<string, { data: DexPoolData; ts: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute cache

export type TokenInfo = {
  address: string;
  name: string;
  symbol: string;
};

export type PriceChange = {
  h1: number;
  h6: number;
  h24: number;
};

export type DexPoolData = {
  pairAddress: string;
  volume24hUsd: number;
  tvlUsd: number;
  priceUsd: number | null;
  priceNative: string | null;
  fdv: number | null;
  marketCap: number | null;
  priceChange: PriceChange | null;
  txns24h: { buys: number; sells: number };
  txns6h: { buys: number; sells: number };
  pairCreatedAt: number | null;
  baseToken: TokenInfo | null;
  quoteToken: TokenInfo | null;
  url: string | null;
  labels: string[];
  boostsActive: number;
};

type DexScreenerPair = {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken?: { address: string; name: string; symbol: string };
  quoteToken?: { address: string; name: string; symbol: string };
  volume?: { h24?: number; h6?: number; h1?: number; m5?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  priceUsd?: string;
  priceNative?: string;
  fdv?: number;
  marketCap?: number;
  priceChange?: { h1?: number; h6?: number; h24?: number };
  txns?: {
    h24?: { buys?: number; sells?: number };
    h6?: { buys?: number; sells?: number };
    m5?: { buys?: number; sells?: number };
  };
  pairCreatedAt?: number;
  url?: string;
  labels?: string[];
  boosts?: { active?: number };
};

/**
 * Fetch DEX Screener data for a single pool address
 */
export async function fetchPoolDexData(poolAddress: string): Promise<DexPoolData | null> {
  const key = poolAddress.toLowerCase();

  // Check cache
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `${DEX_BASE}/pairs/${CHAIN}/${key}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      logger.warn(`[DexVolume] HTTP ${res.status} for ${key}`);
      return null;
    }

    const body = await res.json();
    const pair: DexScreenerPair | null = body?.pair;
    if (!pair) {
      logger.debug(`[DexVolume] No pair data for ${key}`);
      return null;
    }

    const data: DexPoolData = {
      pairAddress: pair.pairAddress,
      volume24hUsd: pair.volume?.h24 ?? 0,
      tvlUsd: pair.liquidity?.usd ?? 0,
      priceUsd: pair.priceUsd ? parseFloat(pair.priceUsd) : null,
      priceNative: pair.priceNative ?? null,
      fdv: pair.fdv ?? null,
      marketCap: pair.marketCap ?? null,
      priceChange: pair.priceChange ? {
        h1: pair.priceChange.h1 ?? 0,
        h6: pair.priceChange.h6 ?? 0,
        h24: pair.priceChange.h24 ?? 0,
      } : null,
      txns24h: {
        buys: pair.txns?.h24?.buys ?? 0,
        sells: pair.txns?.h24?.sells ?? 0,
      },
      txns6h: {
        buys: pair.txns?.h6?.buys ?? 0,
        sells: pair.txns?.h6?.sells ?? 0,
      },
      pairCreatedAt: pair.pairCreatedAt ?? null,
      baseToken: pair.baseToken ? {
        address: pair.baseToken.address,
        name: pair.baseToken.name,
        symbol: pair.baseToken.symbol,
      } : null,
      quoteToken: pair.quoteToken ? {
        address: pair.quoteToken.address,
        name: pair.quoteToken.name,
        symbol: pair.quoteToken.symbol,
      } : null,
      url: pair.url ?? null,
      labels: pair.labels ?? [],
      boostsActive: pair.boosts?.active ?? 0,
    };

    // Cache
    cache.set(key, { data, ts: Date.now() });
    return data;
  } catch (err) {
    logger.warn(`[DexVolume] Fetch failed for ${key}: ${err}`);
    return null;
  }
}

/**
 * Batch fetch DEX Screener data for multiple pool addresses.
 * Returns a Map<poolAddress_lower, DexPoolData>
 */
export async function fetchBatchDexData(
  poolAddresses: string[]
): Promise<Map<string, DexPoolData>> {
  const result = new Map<string, DexPoolData>();
  const unique = [...new Set(poolAddresses.map(a => a.toLowerCase()))];

  // Fetch sequentially to respect rate limits (300/min for pair endpoints)
  for (const addr of unique) {
    const data = await fetchPoolDexData(addr);
    if (data) {
      result.set(addr, data);
    }
    if (unique.length > 1) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  return result;
}

/**
 * Compute APR from volume and fee rate.
 * APR = (volume_24h_usd * fee_rate * 365) / tvl_usd
 * Returns null if TVL is too small or missing.
 */
export function computeApr(
  volume24hUsd: number,
  feeRateBps: number | null,
  tvlUsd: number
): number | null {
  if (!tvlUsd || tvlUsd < 1) return null;
  if (!feeRateBps || feeRateBps <= 0) return null;
  const feeRate = feeRateBps / 1_000_000; // bps to decimal (10000 = 1% = 0.01)
  const dailyFees = volume24hUsd * feeRate;
  const apr = (dailyFees * 365 / tvlUsd) * 100; // as percentage
  return Math.round(apr * 10) / 10; // one decimal
}
