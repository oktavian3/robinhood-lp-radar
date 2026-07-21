export interface PoolCounts {
  total: number; eligible: number; rejected: number;
}
export interface BlockInfo { latestStoredBlock: number; }
export interface SourceHealth {
  source_id: string; last_success_at: string | null;
  last_error: string | null; consecutive_failures: number;
  last_failure_at: string | null;
}
export interface RankingPool {
  token0_symbol: string; token1_symbol: string;
  protocol: string; score: number;
  volume_24h: number; tvl_usd: number;
  apr_pct: number | null; market_cap: number;
  txns_24h: number; confidence: number;
  pool_address: string; pool_id: string;
  fee: number;
}
export interface RangeResult {
  pair: string; ranges: {
    label: string; lowerPrice: string; upperPrice: string;
    tickLower: number; tickUpper: number;
    timeInRange: string; prob24h: string;
    fees: string; il: string; net: string;
    vsHold: string; confidence: string; duration: string;
  }[];
}
export interface TrendingToken {
  priority: number; symbol: string; name: string;
  tokenAddress: string;
  volume24hUsd: number; tvlUsd: number;
  mcap: number; txns24h: number;
  priceUsd: number | null; priceChange24h: number | null;
  totalApr: number | null;
  pools: { pairAddress: string; token0Symbol: string; token1Symbol: string; volume24hUsd: number; tvlUsd: number; apr: number | null; fee: number; url: string }[];
}
export interface QuickRange {
  symbol: string; tokenName: string; tokenAddress: string;
  currentPrice: number; tvlUsd: number; vol24h: number;
  priceChange24h: number | null; feeBps: number;
  estApr: number; dailyFees: number; volRatio: number;
  bestPool: { pair: string; address: string; vol: number; tvl: number; fee: number; dexUrl: string };
  allPools: { pair: string; address: string; vol: number; tvl: number; fee: number }[];
  ranges: { num: number; label: string; lowerPrice: number; upperPrice: number; tickLower: number; tickUpper: number; spreadPct: string; il: string }[];
}
export interface Position {
  token0: string; token1: string; strategy: string;
  initial_capital_usd: number; opened_at: string; status: string;
  latestSnapshot: { position_value_usd: number; net_pnl_usd: number; accrued_fees_usd: number; impermanent_loss_usd: number; in_range: boolean };
}
export interface TrackRecord {
  totalRecommendations: number; winRate: number;
  avgFee: number; avgIl: number; avgNet: number;
  performanceByStrategy: Record<string, { count: number; wins: number; net: number }>;
}
export interface SearchResult {
  poolFound: boolean; query: string;
  tokenSymbol?: string;
  pool?: { protocol: string; token0: string; token1: string; fee: number; status: string };
  tokenPools?: { protocol: string; token0: string; token1: string; fee: number; status: string; token0_symbol: string; token1_symbol: string }[];
  ranges?: { strategy: string; lower: string; upper: string; ticks: string; prob24h: string; net: string; confidence: string }[];
  message?: string;
}
