/**
 * Test the DEX ranking logic directly
 */
import { getDexRankedPools } from "../src/engine/dex-ranking.js";

async function main() {
  console.log("Getting ranked pools...");
  const top = await getDexRankedPools(15);
  console.log(`Got ${top.length} pools`);
  
  for (const p of top) {
    const base = p.base_token_symbol || p.token0.slice(0, 6);
    const quote = p.quote_token_symbol || p.token1.slice(0, 6);
    console.log(
      `${base.padEnd(12)}/${quote.padEnd(5)} TVL=$${String(p.tvl_usd ?? "?").padStart(8)} APR=${String(p.apr_pct?.toFixed(1) ?? "?").padStart(8)}% Score=${p.score}`
    );
  }
  
  // Also show total pools with DEX data
  const total = top.length;
  const withData = top.filter(p => p.tvl_usd !== null && p.tvl_usd > 0).length;
  console.log(`\n${total} ranked, ${withData} with DEX data`);
}

main().catch(console.error);
