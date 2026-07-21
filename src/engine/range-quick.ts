/**
 * Quick range analysis from DEX Screener data.
 * No candles needed — uses DEX Screener price + 24h change for adaptive ranges.
 */
export type RangeQuickResult = {
  symbol: string;
  tokenName: string;
  tokenAddress: string;
  currentPrice: number;
  tvlUsd: number;
  vol24h: number;
  priceChange24h: number | null;
  feeBps: number;
  estApr: number;
  dailyFees: number;
  volRatio: number;
  volFactor: number;
  bestPool: { pair: string; address: string; vol: number; tvl: number; fee: number; dexUrl: string };
  allPools: { pair: string; address: string; vol: number; tvl: number; fee: number }[];
  ranges: {
    num: number; label: string;
    lowerPrice: number; upperPrice: number;
    tickLower: number; tickUpper: number;
    spreadPct: string; il: string;
  }[];
};

function fmt(n: number): string { return n.toLocaleString("en-US", { maximumFractionDigits: 2 }); }
function p2t(p: number): number { return Math.floor(Math.log(p) / Math.log(1.0001)); }

async function dexSearch(query: string): Promise<any[]> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.pairs || []).filter((p: any) => p.chainId === "robinhood");
}

export async function quickRangeAnalysis(input: string): Promise<{ error?: string; data?: RangeQuickResult }> {
  const isCA = /^0x[a-fA-F0-9]{40}$/.test(input.trim());
  const searchQ = isCA ? input.trim().toLowerCase() : input.trim();

  // Search DEX Screener
  let rh = await dexSearch(searchQ);
  if (rh.length === 0) {
    // Try as address search if symbol failed
    if (!isCA) {
      rh = await dexSearch(`0x${searchQ}`);
    }
    if (rh.length === 0) return { error: `No Robinhood pools found for: ${input}` };
  }

  // Sort by volume descending
  rh.sort((a: any, b: any) => parseFloat(b.volume?.h24 || 0) - parseFloat(a.volume?.h24 || 0));

  const top = rh[0];
  const tokenAddr = isCA ? searchQ : (top.baseToken?.address || top.quoteToken?.address || "").toLowerCase();
  const symbol = top.baseToken?.symbol || "?";
  const tokenName = top.baseToken?.name || symbol;

  // All pools for this token
  const tokenPools = rh.filter((p: any) =>
    (p.baseToken?.address || "").toLowerCase() === tokenAddr ||
    (p.quoteToken?.address || "").toLowerCase() === tokenAddr
  );
  const pools = (tokenPools.length > 0 ? tokenPools : rh).slice(0, 8);

  const currentPrice = parseFloat(top.priceUsd);
  if (!currentPrice || currentPrice <= 0) return { error: "Price unavailable" };

  const tvlUsd = parseFloat(top.liquidity?.usd || 0);
  const vol24h = parseFloat(top.volume?.h24 || 0);
  const priceChange24h = top.priceChange?.h24 ?? null;
  const feeBps = parseInt(top.fee) || 30;

  const feeRate = feeBps / 10000;
  const dailyFees = vol24h * feeRate;
  const estApr = tvlUsd > 0 ? (dailyFees * 365 / tvlUsd) * 100 : 0;
  const volRatio = tvlUsd > 0 ? vol24h / tvlUsd : 0;

  // Adaptive range widths
  const volFactor = priceChange24h ? Math.min(3, Math.max(0.5, Math.abs(priceChange24h) / 100)) : 0.3;
  const narrowSpread = Math.min(0.55, 0.10 + volFactor * 0.15);
  const balancedSpread = Math.min(0.80, 0.20 + volFactor * 0.30);
  const wideSpread = Math.min(0.90, 0.35 + volFactor * 0.55);

  const rangeDefs = [
    { label: "Narrow", low: 1 - narrowSpread, high: 1 + narrowSpread },
    { label: "Balanced", low: 1 - balancedSpread, high: 1 + balancedSpread },
    { label: "Wide", low: 1 - wideSpread, high: 1 + wideSpread },
    { label: "Buy Below", low: 0.20, high: 1 - narrowSpread * 0.5 },
    { label: "Sell Above", low: 1 + narrowSpread * 0.5, high: 1 + wideSpread * 2 },
  ];

  const allPools = pools.map((p: any) => ({
    pair: `${p.baseToken?.symbol || "?"}/${p.quoteToken?.symbol || "?"}`,
    address: p.pairAddress,
    vol: parseFloat(p.volume?.h24 || 0),
    tvl: parseFloat(p.liquidity?.usd || 0),
    fee: parseInt(p.fee) || 30,
  }));

  const bestPool = {
    pair: allPools[0]?.pair || "?/?",
    address: top.pairAddress || "",
    vol: allPools[0]?.vol || 0,
    tvl: allPools[0]?.tvl || 0,
    fee: allPools[0]?.fee || 30,
    dexUrl: top.url || "",
  };

  const ranges = rangeDefs.map((r, i) => {
    const l = Math.max(0.0000000001, currentPrice * r.low);
    const u = currentPrice * r.high;
    const tl = p2t(l);
    const tu = p2t(u);
    return {
      num: i + 1,
      label: r.label,
      lowerPrice: l,
      upperPrice: u,
      tickLower: tl,
      tickUpper: tu,
      spreadPct: ((r.high / r.low - 1) * 100).toFixed(1),
      il: (priceChange24h != null && Math.abs(priceChange24h) > 10)
        // For volatile tokens, estimate IL at half the daily swing coverage
        ? ((2 * Math.sqrt(1 + (u/l) / 4) / (1 + (u/l) / 4 + 1) - 1) * 100).toFixed(2)
        : ((2 * Math.sqrt(1 + (u/l)) / (1 + (u/l) + 1) - 1) * 100).toFixed(2),
    };
  });

  return {
    data: {
      symbol, tokenName,
      tokenAddress: tokenAddr,
      currentPrice, tvlUsd, vol24h, priceChange24h,
      feeBps, estApr, dailyFees, volRatio, volFactor,
      bestPool, allPools, ranges,
    },
  };
}
