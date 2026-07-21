export type Protocol = "v2" | "v3" | "v4";

export type StrategyIntent =
  | "EARN_FEES_AROUND_CURRENT_PRICE"
  | "BUY_TOKEN_BELOW"
  | "SELL_TOKEN_ABOVE";

export interface NormalizedPool {
  chainId: 4663;
  protocol: Protocol;
  poolAddress?: `0x${string}`;
  poolId?: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee?: number;
  tickSpacing?: number;
  hooks?: `0x${string}`;
}

export interface MarketSnapshot {
  source: string;
  fetchedAt: string;
  priceUsd?: number;
  liquidityUsd?: number;
  volume1hUsd?: number;
  volume24hUsd?: number;
  volume7dUsd?: number;
  swaps24h?: number;
  priceChange24hPct?: number;
}

export interface RangeRecommendation {
  pool: NormalizedPool;
  strategy: StrategyIntent;
  currentPrice: string;
  lowerPrice: string;
  upperPrice: string;
  tickLower?: number;
  tickUpper?: number;
  depositAsset: `0x${string}`;
  depositRatio: Record<string, number>;
  estimatedDurationHours: [number, number];
  stayProbability: {
    h12?: number;
    h24?: number;
    d3?: number;
    d7?: number;
  };
  score: number;
  confidence: number;
  riskFlags: string[];
}
