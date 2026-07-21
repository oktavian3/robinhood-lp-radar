import "dotenv/config";
import { getAddress } from "viem";
import { assertRobinhoodChain, rpcClient } from "../src/lib/rpc.js";
import { searchPairs } from "../src/lib/dexscreener.js";
import { coinGecko } from "../src/lib/coingecko.js";
import contracts from "../config/contracts.json" with { type: "json" };

type Result = {
  source: string;
  ok: boolean;
  detail: string;
};

const results: Result[] = [];

async function checkRpc() {
  const started = Date.now();
  await assertRobinhoodChain();
  const block = await rpcClient.getBlockNumber();

  const addresses = [
    contracts.uniswapV2.factory,
    contracts.uniswapV3.factory,
    contracts.uniswapV4.poolManager,
    contracts.uniswapV4.stateView,
  ];

  for (const raw of addresses) {
    const address = getAddress(raw);
    const code = await rpcClient.getCode({ address });
    if (!code || code === "0x") {
      throw new Error(`No bytecode at ${address}`);
    }
  }

  results.push({
    source: "Robinhood RPC",
    ok: true,
    detail: `chain=4663 block=${block} latency=${Date.now() - started}ms`,
  });
}

async function checkDexScreener() {
  const started = Date.now();
  const pairs = await searchPairs("robinhood");
  results.push({
    source: "DEX Screener",
    ok: true,
    detail: `reachable; ${pairs.length} search results; latency=${Date.now() - started}ms`,
  });
}

async function checkCoinGecko() {
  if (!process.env.COINGECKO_API_KEY) {
    results.push({
      source: "CoinGecko Onchain",
      ok: false,
      detail: "skipped: COINGECKO_API_KEY is empty",
    });
    return;
  }

  const started = Date.now();
  const response = await coinGecko.topPools(1);
  const count =
    typeof response === "object" &&
    response !== null &&
    "data" in response &&
    Array.isArray((response as { data?: unknown[] }).data)
      ? (response as { data: unknown[] }).data.length
      : -1;

  results.push({
    source: "CoinGecko Onchain",
    ok: true,
    detail: `network=robinhood pools=${count} latency=${Date.now() - started}ms`,
  });
}

async function main() {
  const checks = [
    ["Robinhood RPC", checkRpc],
    ["DEX Screener", checkDexScreener],
    ["CoinGecko Onchain", checkCoinGecko],
  ] as const;

  for (const [name, check] of checks) {
    try {
      await check();
    } catch (error) {
      results.push({
        source: name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.table(results);

  const requiredFailures = results.filter(
    (result) =>
      !result.ok &&
      (result.source === "Robinhood RPC" ||
        result.source === "DEX Screener"),
  );

  if (requiredFailures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
