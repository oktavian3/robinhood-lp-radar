#!/usr/bin/env node
/**
 * 🔥 Range Helper — Auto-detect by CA or symbol
 * Usage:
 *   node range-helper.js 0x39dbed3a2bd333467115de45665cc57f813c4571   ← by CA
 *   node range-helper.js PONS         ← by symbol
 *   node range-helper.js FOX 18932    ← batch multiple tokens
 */

const inputs = process.argv.slice(2);
if (inputs.length === 0) { console.log("Usage: node range-helper.js <CA_or_symbol> [more...]"); process.exit(1); }

async function analyzeToken(input) {
  const isCA = /^0x[a-fA-F0-9]{40}$/.test(input.trim());
  const searchQ = isCA ? input.trim().toLowerCase() : input.trim();
  
  // Fetch from DEX Screener
  const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${searchQ}`);
  const data = await res.json();
  const rh = (data.pairs || []).filter(p => p.chainId === "robinhood");
  if (rh.length === 0) {
    const anyChain = (data.pairs || []).filter(p => p.chainId);
    if (anyChain.length > 0 && !isCA) {
      // Maybe found on other chain — try as CA
      const addrSearch = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${input.toLowerCase()}`);
      const addrData = await addrSearch.json();
      const rh2 = (addrData.pairs || []).filter(p => p.chainId === "robinhood");
      if (rh2.length > 0) return processPools(rh2, input);
    }
    return { error: `❌ No Robinhood pools found for: ${input}` };
  }

  // Sort by volume descending
  rh.sort((a,b) => parseFloat(b.volume?.h24 || 0) - parseFloat(a.volume?.h24 || 0));

  // Get token info
  const top = rh[0];
  const tokenAddr = isCA ? searchQ : (top.baseToken?.address || top.quoteToken?.address || '').toLowerCase();
  const symbol = top.baseToken?.symbol || '?';
  const tokenName = top.baseToken?.name || symbol;

  // Find all pools for THIS specific token
  const tokenPools = rh.filter(p => 
    (p.baseToken?.address || '').toLowerCase() === tokenAddr ||
    (p.quoteToken?.address || '').toLowerCase() === tokenAddr
  );

  return processPools(tokenPools.length > 0 ? tokenPools : rh, input, symbol, tokenName, tokenAddr);
}

function processPools(pools, input, forcedSymbol, forcedName, forcedAddr) {
  // Top pool
  const top = pools[0];
  const currentPrice = parseFloat(top.priceUsd);
  const tvlUsd = parseFloat(top.liquidity?.usd || 0);
  const vol24h = parseFloat(top.volume?.h24 || 0);
  const priceChange24h = top.priceChange?.h24;
  const feeBps = parseInt(top.fee) || 30;
  const symbol = forcedSymbol || top.baseToken?.symbol || '?';
  const tokenName = forcedName || top.baseToken?.name || symbol;
  const tokenAddr = forcedAddr || (top.baseToken?.address || top.quoteToken?.address || '').toLowerCase();
  const tokenAddrShort = tokenAddr ? `${tokenAddr.slice(0,6)}...${tokenAddr.slice(-4)}` : 'N/A';
  
  // Find the absolute best pool for this token
  const allPools = pools.map(p => ({
    pair: `${p.baseToken?.symbol || '?'}/${p.quoteToken?.symbol || '?'}`,
    address: p.pairAddress,
    vol: parseFloat(p.volume?.h24 || 0),
    tvl: parseFloat(p.liquidity?.usd || 0),
    price: parseFloat(p.priceUsd),
    change24h: p.priceChange?.h24,
    fee: parseInt(p.fee) || 30,
    dexUrl: p.url,
    fdv: parseFloat(p.fdv || 0),
  })).sort((a,b) => b.vol - a.vol);

  // Use top pool for range calculation
  const bestPool = allPools[0];
  const poolPrice = bestPool.price || currentPrice;

  return {
    symbol, tokenName, tokenAddr: tokenAddr || 'N/A', tokenAddrShort,
    currentPrice: poolPrice || currentPrice,
    tvlUsd, vol24h, priceChange24h, feeBps,
    allPools: allPools.slice(0, 8),
    bestPool,
  };
}

function fmt(n) { return n.toLocaleString('en-US', {maximumFractionDigits: 2}); }
function p2t(p) { return Math.floor(Math.log(p) / Math.log(1.0001)); }
function generateRanges(result) {
  const { symbol, currentPrice, tvlUsd, vol24h, priceChange24h, feeBps, allPools, bestPool, tokenAddrShort } = result;
  if (!currentPrice || currentPrice <= 0) return { error: "Price unavailable" };

  const feeRate = feeBps / 10000;
  const dailyFees = vol24h * feeRate;
  const estApr = tvlUsd > 0 ? (dailyFees * 365 / tvlUsd) * 100 : 0;
  const volRatio = tvlUsd > 0 ? vol24h / tvlUsd : 0;

  // Adaptive range widths based on volatility
  const volFactor = priceChange24h ? Math.min(3, Math.max(0.5, Math.abs(priceChange24h) / 100)) : 0.3;
  const narrowSpread = Math.min(0.55, 0.10 + volFactor * 0.15);  // cap at 55%
  const balancedSpread = Math.min(0.80, 0.20 + volFactor * 0.30); // cap at 80%
  const wideSpread = Math.min(0.90, 0.35 + volFactor * 0.55);     // cap at 90%

  const ranges = [
    {label: 'Narrow',  low: 1 - narrowSpread, high: 1 + narrowSpread},
    {label: 'Balanced', low: 1 - balancedSpread, high: 1 + balancedSpread},
    {label: 'Wide',    low: 1 - wideSpread, high: 1 + wideSpread},
    {label: 'BUY BELOW', low: 0.20, high: 1 - narrowSpread * 0.5},
    {label: 'SELL ABOVE', low: 1 + narrowSpread * 0.5, high: 1 + wideSpread * 2},
  ];

  function calcIL(lowRatio, highRatio) {
    const r = Math.sqrt(highRatio / lowRatio);
    const sqrtP = Math.sqrt(1);
    return (2 * r / (1 + r) - 1) * 100;
  }

  return {
    symbol, currentPrice, tvlUsd, vol24h, priceChange24h,
    feeBps, estApr, dailyFees, volRatio,
    bestPool, allPools, tokenAddrShort,
    volFactor: volFactor,
    narrowSpread: narrowSpread,
    ranges: ranges.map((r, i) => {
      const l = currentPrice * r.low;
      const u = currentPrice * r.high;
      const tl = p2t(l);
      const tu = p2t(u);
      return {
        num: i+1, label: r.label,
        lowerPrice: l, upperPrice: u,
        tickLower: tl, tickUpper: tu,
        spreadPct: ((r.high / r.low - 1) * 100).toFixed(1),
        il: calcIL(r.low, r.high).toFixed(2),
      };
    }),
  };
}

function printResult(data) {
  if (data.error) { console.log(data.error); return; }

  const r = generateRanges(data);
  if (r.error) { console.log(r.error); return; }

  const chg = r.priceChange24h;
  const chgStr = chg != null ? `${chg > 0 ? '+' : ''}${chg}%${Math.abs(chg || 0) > 50 ? ' ⚡' : ''}` : 'N/A';

  console.log('');
  console.log(`╔══════════════════════════════════════════════════════════════════════════╗`);
  console.log(`║           🔥 ${r.symbol.padEnd(25)} RANGE ANALYSIS                       ║`);
  console.log(`╠══════════════════════════════════════════════════════════════════════════╣`);
  console.log(`║  Token:       ${r.symbol.padEnd(8)} · ${r.tokenAddrShort}                               ║`);
  console.log(`║  Price:       $ ${String(r.currentPrice.toFixed(6)).padStart(10)}   24h: ${chgStr}${''.padEnd(Math.max(0, 28 - chgStr.length))} ║`);
  console.log(`║  Best Pool:   ${r.bestPool.pair.padEnd(10)} · Vol $${fmt(r.vol24h).padStart(12)} · TVL $${fmt(r.tvlUsd).padStart(12)} ║`);
  console.log(`║  APR:         ${r.estApr.toFixed(1)}% · Fee $${fmt(r.dailyFees)}/day · Vol/TVL ${r.volRatio.toFixed(1)}x           ║`);
  console.log(`║  Volatility:  ${(r.volFactor * 100).toFixed(0)}% factor (adapted to ${Math.abs(chg || 0).toFixed(0)}% daily swing)         ║`);
  console.log(`╠══════════════════════════════════════════════════════════════════════════╣`);
  console.log(`║  #  STRATEGY            LOWER $       UPPER $       TICKS         IL   ║`);
  console.log(`╠══════════════════════════════════════════════════════════════════════════╣`);

  r.ranges.forEach(rng => {
    console.log(
      `║  ${rng.num}  ${rng.label.padEnd(20)}` +
      `$ ${rng.lowerPrice.toFixed(6).padStart(10)}` +
      `  $ ${rng.upperPrice.toFixed(6).padStart(10)}` +
      `  ${String(rng.tickLower).padStart(7)}/${String(rng.tickUpper).padEnd(7)}` +
      ` ${rng.il}%${rng.il < 0 ? '' : ' '} ║`
    );
  });

  console.log(`╠══════════════════════════════════════════════════════════════════════════╣`);

  // Pool comparison
  if (r.allPools.length > 1) {
    console.log(`║  ALL POOLS FOR ${r.symbol}:                                                ║`);
    r.allPools.slice(0, 5).forEach((p, i) => {
      console.log(`║  ${i+1}. ${p.pair.padEnd(12)} · Vol $${fmt(p.vol).padStart(12)} · TVL $${fmt(p.tvl).padStart(12)} · ${p.fee}bps  ║`);
    });
    if (r.allPools.length > 5) console.log(`║     ... +${r.allPools.length - 5} more pools                                        ║`);
    console.log(`╠══════════════════════════════════════════════════════════════════════════╣`);
  }

  console.log(`║  VERDICT:                                                                    ║`);
  if (r.volRatio > 5) {
    console.log(`║  ✅ HIGH VOLUME — Worth LPing! Vol/TVL ${r.volRatio.toFixed(1)}x                           ║`);
    console.log(`║  → Narrow #1:  Capital efficient, rebalance 6-12h                              ║`);
    console.log(`║  → Balanced #2: Best balance, rebalance 12-24h                                  ║`);
    console.log(`║  → Wide #3:    Safer, rebalance 24-48h                                          ║`);
  } else if (r.volRatio > 1) {
    console.log(`║  ⚠️  Moderate volume (${r.volRatio.toFixed(1)}x vol/TVL) — start with Balanced #2            ║`);
  } else {
    console.log(`║  ❌ Low volume (${r.volRatio.toFixed(1)}x vol/TVL) — not worth LPing                         ║`);
  }
  console.log(`║  📊 Open on DEX Screener: ${r.bestPool.dexUrl || 'N/A'.padEnd(38)} ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════════╝`);
}

async function main() {
  for (const input of inputs) {
    const data = await analyzeToken(input);
    printResult(data);
  }
}

main().catch(e => { console.error("Runtime error:", e.message); process.exit(1); });
