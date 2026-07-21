import Bottleneck from "bottleneck";

const BASE =
  process.env.COINGECKO_API_BASE ??
  "https://pro-api.coingecko.com/api/v3";
const API_KEY = process.env.COINGECKO_API_KEY;
const API_KEY_HEADER =
  process.env.COINGECKO_API_KEY_HEADER ?? "x-cg-pro-api-key";
const NETWORK = process.env.COINGECKO_NETWORK_ID ?? "robinhood";

const limiter = new Bottleneck({
  minTime: 650,
  maxConcurrent: 2,
});

async function request(path: string): Promise<unknown> {
  if (!API_KEY) {
    throw new Error("COINGECKO_API_KEY is not configured.");
  }

  return limiter.schedule(async () => {
    const response = await fetch(`${BASE}${path}`, {
      headers: {
        Accept: "application/json",
        [API_KEY_HEADER]: API_KEY,
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(
        `CoinGecko ${response.status}: ${await response.text()}`,
      );
    }

    return response.json();
  });
}

export const coinGecko = {
  topPools: (page = 1) =>
    request(`/onchain/networks/${NETWORK}/pools?page=${page}`),

  newPools: (page = 1) =>
    request(`/onchain/networks/${NETWORK}/new_pools?page=${page}`),

  tokenPools: (tokenAddress: string, page = 1) =>
    request(
      `/onchain/networks/${NETWORK}/tokens/${tokenAddress}/pools?page=${page}`,
    ),

  poolInfo: (poolAddressOrId: string) =>
    request(
      `/onchain/networks/${NETWORK}/pools/${poolAddressOrId}/info`,
    ),

  poolOhlcv: (
    poolAddressOrId: string,
    timeframe: "minute" | "hour" | "day",
    aggregate = 5,
    limit = 1000,
  ) =>
    request(
      `/onchain/networks/${NETWORK}/pools/${poolAddressOrId}/ohlcv/${timeframe}` +
        `?aggregate=${aggregate}&limit=${limit}`,
    ),

  poolTrades: (poolAddressOrId: string) =>
    request(
      `/onchain/networks/${NETWORK}/pools/${poolAddressOrId}/trades`,
    ),

  topHolders: (tokenAddress: string) =>
    request(
      `/onchain/networks/${NETWORK}/tokens/${tokenAddress}/top_holders`,
    ),

  holdersChart: (tokenAddress: string, days: 7 | 30 | "max" = 7) =>
    request(
      `/onchain/networks/${NETWORK}/tokens/${tokenAddress}/holders_chart?days=${days}`,
    ),

  searchPools: (query: string) =>
    request(
      `/onchain/search/pools?query=${encodeURIComponent(query)}&network=${NETWORK}`,
    ),
};
