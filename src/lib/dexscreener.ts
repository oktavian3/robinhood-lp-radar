import Bottleneck from "bottleneck";
import { z } from "zod";

const BASE =
  process.env.DEXSCREENER_API_BASE ?? "https://api.dexscreener.com";
const CHAIN = process.env.DEXSCREENER_CHAIN_ID ?? "robinhood";

const limiter = new Bottleneck({
  minTime: 220,
  maxConcurrent: 3,
});

const TokenSchema = z.object({
  address: z.string(),
  name: z.string().optional(),
  symbol: z.string().optional(),
});

const PairSchema = z
  .object({
    chainId: z.string().optional(),
    dexId: z.string().optional(),
    url: z.string().optional(),
    pairAddress: z.string().optional(),
    labels: z.array(z.string()).nullable().optional(),
    baseToken: TokenSchema.optional(),
    quoteToken: TokenSchema.optional(),
    priceNative: z.string().optional(),
    priceUsd: z.string().nullable().optional(),
    txns: z.record(z.string(), z.unknown()).optional(),
    volume: z.record(z.string(), z.unknown()).optional(),
    priceChange: z.record(z.string(), z.unknown()).nullable().optional(),
    liquidity: z.record(z.string(), z.unknown()).nullable().optional(),
    fdv: z.number().nullable().optional(),
    marketCap: z.number().nullable().optional(),
    pairCreatedAt: z.number().nullable().optional(),
    info: z.unknown().optional(),
  })
  .passthrough();

const SearchResponseSchema = z.object({
  schemaVersion: z.string().optional(),
  pairs: z.array(PairSchema).nullable().optional(),
});

async function getJson(url: string): Promise<unknown> {
  return limiter.schedule(async () => {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(
        `DEX Screener ${response.status}: ${await response.text()}`,
      );
    }

    return response.json();
  });
}

export async function searchPairs(query: string) {
  const raw = await getJson(
    `${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`,
  );
  return SearchResponseSchema.parse(raw).pairs ?? [];
}

export async function getPair(pairId: string) {
  const raw = await getJson(
    `${BASE}/latest/dex/pairs/${CHAIN}/${encodeURIComponent(pairId)}`,
  );
  return SearchResponseSchema.parse(raw).pairs ?? [];
}

export async function getTokenPairs(tokenAddress: string) {
  const raw = await getJson(
    `${BASE}/token-pairs/v1/${CHAIN}/${encodeURIComponent(tokenAddress)}`,
  );
  return z.array(PairSchema).parse(raw);
}

export async function getTokens(tokenAddresses: string[]) {
  if (tokenAddresses.length === 0 || tokenAddresses.length > 30) {
    throw new Error("DEX Screener accepts between 1 and 30 token addresses.");
  }

  const raw = await getJson(
    `${BASE}/tokens/v1/${CHAIN}/${tokenAddresses.join(",")}`,
  );
  return z.array(PairSchema).parse(raw);
}
