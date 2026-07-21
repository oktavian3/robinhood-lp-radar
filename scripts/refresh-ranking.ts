import { getDexRankedPools } from "../src/engine/dex-ranking.js";

async function main() {
  console.log("Refreshing DEX ranking cache...");
  const top = await getDexRankedPools(10);
  console.log(`\nTop ${top.length} pools:`);
  for (const p of top) {
    const base = p.base_token_symbol || p.token0.slice(0, 6);
    const quote = p.quote_token_symbol || p.token1.slice(0, 6);
    console.log(
      `${base}/${quote} ${p.protocol} TVL=$${p.tvl_usd?.toLocaleString() || "0"} Vol=$${p.volume_24h?.toLocaleString() || "0"} APR=${p.apr_pct?.toFixed(1) || "?"}% Score=${p.score}`
    );
  }
  console.log("\nDone! Checking after 60s...");
  
  // Wait for cache to refresh with more data
  await new Promise(r => setTimeout(r, 60000));
  
  const top2 = await getDexRankedPools(10);
  console.log(`\nAfter 60s - Top ${top2.length} pools:`);
  for (const p of top2) {
    const base = p.base_token_symbol || p.token0.slice(0, 6);
    const quote = p.quote_token_symbol || p.token1.slice(0, 6);
    console.log(
      `${base}/${quote} ${p.protocol} TVL=$${p.tvl_usd?.toLocaleString() || "0"} Vol=$${p.volume_24h?.toLocaleString() || "0"} APR=${p.apr_pct?.toFixed(1) || "?"}% Score=${p.score}`
    );
  }
}

main().catch(console.error);
