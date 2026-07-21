import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { getSourceHealth, getPoolCounts, getPools, getPoolByAddress, getPoolByTokens } from "../db/index.js";
import { getTopPools } from "../engine/scoring.js";
import { evaluateRangeForPool } from "../engine/range-engine.js";
import { getPositions, getTrackRecord } from "../engine/paper-tracker.js";
import { getPairName, getSymbol, resolveTokens } from "../lib/token-resolver.js";
import { fetchBatchDexData, computeApr } from "../lib/dex-volume.js";
import { getDexRankedPools } from "../engine/dex-ranking.js";
import { getTrendingTokens, importTrendingPools } from "../engine/trending.js";
import { quickRangeAnalysis } from "../engine/range-quick.js";

const PORT = parseInt(process.env.HEALTH_PORT ?? "7474");
const DASHBOARD_HTML = join(import.meta.dirname, "..", "..", "dashboard", "index.html");

function json(res: ServerResponse, data: any, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data, null, 2));
}
function html(res: ServerResponse, content: string, status = 200): void {
  res.writeHead(status, { "Content-Type": "text/html" });
  res.end(content);
}

export async function startHealthServer(): Promise<void> {
  let dashboardContent: string;
  try { dashboardContent = readFileSync(DASHBOARD_HTML, "utf-8"); }
  catch { dashboardContent = "<h1>Dashboard not found</h1>"; }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" });
      res.end();
      return;
    }

    try {
      // Dashboard
      if (path === "/" || path === "/dashboard") { html(res, dashboardContent); return; }

      switch (path) {
        // ── Core ──────────────────────────────────
        case "/health": {
          json(res, { status: "ok", timestamp: new Date().toISOString(), sources: await getSourceHealth() });
          return;
        }
        case "/pools": {
          const status = url.searchParams.get("status") || undefined;
          json(res, { pools: await getPools(status), total: (await getPools(status)).length });
          return;
        }
        case "/pools/counts": {
          json(res, await getPoolCounts());
          return;
        }
        case "/blocks/latest": {
          const { getLatestBlock } = await import("../db/index.js");
          json(res, { chainId: 4663, latestStoredBlock: await getLatestBlock(), timestamp: new Date().toISOString() });
          return;
        }

        // ── Ranking ────────────────────────────────
        case "/rankings": {
          // Use DEX-based ranking (APR/volume primary) instead of legacy scoring
          const top = await getDexRankedPools(10);
          // Resolve token symbols
          const allTokens = new Set<string>();
          for (const p of top) { allTokens.add(p.token0); allTokens.add(p.token1); }
          const tokenMap = await resolveTokens([...allTokens]);
          const enriched = top.map(p => ({
            ...p,
            token0_symbol: tokenMap.get(p.token0.toLowerCase())?.symbol || p.token0.slice(0, 6),
            token1_symbol: tokenMap.get(p.token1.toLowerCase())?.symbol || p.token1.slice(0, 6),
          }));
          json(res, { generatedAt: new Date().toISOString(), count: enriched.length, rankings: enriched });
          return;
        }

        // ── Range Engine ───────────────────────────
        case "/ranges": {
          const top = await getTopPools(5, 0);
          const result: any[] = [];
          // Pre-resolve all token symbols
          const allTokens = new Set<string>();
          for (const pool of top) { allTokens.add(pool.token0); allTokens.add(pool.token1); }
          const tokenMap = await resolveTokens([...allTokens]);
          for (const pool of top) {
            const ranges = await evaluateRangeForPool(pool.poolId);
            if (ranges.length > 0) {
              const sym0 = tokenMap.get(pool.token0.toLowerCase())?.symbol || pool.token0.slice(0, 6);
              const sym1 = tokenMap.get(pool.token1.toLowerCase())?.symbol || pool.token1.slice(0, 6);
              result.push({
                poolId: pool.poolId, protocol: pool.protocol,
                pair: `${sym0}/${sym1}`,
                token0_symbol: sym0, token1_symbol: sym1,
                score: pool.score,
                ranges: ranges.map(r => ({
                  strategy: r.candidate.strategy,
                  label: r.candidate.label,
                  lowerPrice: r.candidate.lowerPrice,
                  upperPrice: r.candidate.upperPrice,
                  tickLower: r.candidate.tickLower,
                  tickUpper: r.candidate.tickUpper,
                  depositAsset: (r.candidate.depositAsset||'').slice(0,8),
                  depositRatio: `${(r.candidate.depositRatio[0]*100).toFixed(0)}/${(r.candidate.depositRatio[1]*100).toFixed(0)}`,
                  timeInRange: Math.round(r.timeInRangePct) + "%",
                  prob24h: Math.round(r.prob24h * 100) + "%",
                  medianExitHours: r.medianTimeToExitHours?.toFixed(1) ?? "N/A",
                  fees: "$" + r.estimatedGrossFeesUsd.toFixed(2),
                  il: "$" + r.estimatedIlUsd.toFixed(2),
                  net: "$" + r.estimatedNetUsd.toFixed(2),
                  vsHold: r.estimatedNetVsHoldPct.toFixed(1) + "%",
                  confidence: r.confidence + "%",
                  vol24h: (r.realizedVol24h * 100).toFixed(1) + "%",
                  duration: `${r.estimatedDurationHours[0]}-${r.estimatedDurationHours[1]}h`,
                })),
              });
            }
          }
          json(res, { generatedAt: new Date().toISOString(), count: result.length, ranges: result });
          return;
        }

        // ── Search ─────────────────────────────────
        case "/search": {
          const q = (url.searchParams.get("q") || "").trim().toLowerCase();
          if (!q.startsWith("0x") || q.length < 20) {
            json(res, { error: "Invalid address. Provide a valid 0x-prefixed EVM address." }, 400);
            return;
          }
          // Try pool address
          let pool = await getPoolByAddress(q);
          // Try token address
          if (!pool) {
            const tokenPools = await getPoolByTokens(q, q);
            // Resolve token symbols
            const allTokens = new Set<string>();
            for (const p of tokenPools) { allTokens.add(p.token0); allTokens.add(p.token1); }
            allTokens.add(q);
            const tokenMap = await resolveTokens([...allTokens]);
            json(res, {
              query: q,
              poolFound: false,
              tokenSymbol: tokenMap.get(q.toLowerCase())?.symbol || q.slice(0, 6),
              tokenPools: tokenPools.length > 0 ? tokenPools.map(p => ({
                id: p.id, protocol: p.protocol, address: p.pool_address, poolId: p.pool_id,
                token0: p.token0, token1: p.token1, fee: p.fee, status: p.status,
                token0_symbol: tokenMap.get(p.token0.toLowerCase())?.symbol || p.token0.slice(0, 6),
                token1_symbol: tokenMap.get(p.token1.toLowerCase())?.symbol || p.token1.slice(0, 6),
              })) : [],
              message: tokenPools.length > 0 ? `${tokenPools.length} pools found for this token` : "No matching pools found",
            });
            return;
          }
          // Pool found — resolve symbols
          const sym0 = await getSymbol(pool.token0);
          const sym1 = await getSymbol(pool.token1);
          const ranges = await evaluateRangeForPool(pool.id);
          json(res, {
            query: q,
            poolFound: true,
            token0_symbol: sym0,
            token1_symbol: sym1,
            pool: {
              id: pool.id, protocol: pool.protocol, address: pool.pool_address, poolId: pool.pool_id,
              token0: pool.token0, token1: pool.token1, token0_symbol: sym0, token1_symbol: sym1,
              fee: pool.fee, tickSpacing: pool.tick_spacing,
              hooks: pool.hooks, status: pool.status,
            },
            ranges: ranges.slice(0, 3).map(r => ({
              strategy: r.candidate.label,
              lower: r.candidate.lowerPrice,
              upper: r.candidate.upperPrice,
              ticks: `${r.candidate.tickLower}/${r.candidate.tickUpper}`,
              prob24h: Math.round(r.prob24h * 100) + "%",
              net: "$" + r.estimatedNetUsd.toFixed(2),
              confidence: r.confidence + "%",
            })),
          });
          return;
        }

        // ── Positions ──────────────────────────────
        case "/positions": {
          json(res, { positions: await getPositions(20) });
          return;
        }

        // ── Trending ────────────────────────────────
        case "/trending": {
          const tokens = await getTrendingTokens(15);
          // Import missing pools to DB (background)
          importTrendingPools(tokens).catch(() => {});
          json(res, {
            generatedAt: new Date().toISOString(),
            count: tokens.length,
            chain: "robinhood",
            trending: tokens.map(t => ({
              tokenAddress: t.tokenAddress,
              symbol: t.symbol,
              name: t.name,
              volume24hUsd: t.volume24hUsd,
              tvlUsd: t.tvlUsd,
              mcap: t.mcap,
              priceUsd: t.priceUsd,
              priceChange24h: t.priceChange24h,
              txns24h: t.txns24h,
              priority: t.priority,
              totalApr: t.pools.length > 0 ? Math.max(...t.pools.map(p => p.apr ?? 0)) : null,
              pools: t.pools.map(p => ({
                pairAddress: p.pairAddress,
                protocol: p.protocol,
                token0Symbol: p.token0Symbol,
                token1Symbol: p.token1Symbol,
                volume24hUsd: p.dexData?.volume24hUsd ?? 0,
                tvlUsd: p.dexData?.tvlUsd ?? 0,
                apr: p.apr,
                fee: p.effectiveFee,
                fdv: p.dexData?.fdv,
                marketCap: p.dexData?.marketCap,
                priceUsd: p.dexData?.priceUsd,
                txns24h: p.dexData ? (p.dexData.txns24h.buys + p.dexData.txns24h.sells) : 0,
                url: p.dexData?.url,
              })),
            })),
          });
          return;
        }

        // ── Track Record ───────────────────────────
        case "/track-record": {
          json(res, { record: await getTrackRecord(30) });
          return;
        }

        // ── Quick Range (DEX-based, no candles needed) ──
        case "/range-token": {
          const q = (url.searchParams.get("q") || "").trim();
          if (!q) {
            json(res, { error: "Provide ?q=<symbol_or_contract_address>" }, 400);
            return;
          }
          const result = await quickRangeAnalysis(q);
          if (result.error) {
            json(res, { error: result.error }, 404);
            return;
          }
          json(res, {
            generatedAt: new Date().toISOString(),
            query: q,
            chain: "robinhood",
            ...result.data,
          });
          return;
        }

        default:
          json(res, { error: "not found", path }, 404);
      }
    } catch (error) {
      json(res, { error: String(error) }, 500);
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(PORT, () => {
      console.log(`[Health] Server on http://localhost:${PORT}`);
      console.log(`  /           — Dashboard`);
      console.log(`  /health     — Source health`);
      console.log(`  /pools      — All pools`);
      console.log(`  /rankings   — Top 10 scored pools`);
      console.log(`  /ranges     — Range engine results`);
      console.log(`  /search?q=  — Search by contract address`);
      console.log(`  /positions  — Paper positions + PnL`);
      console.log(`  /track-record — Performance history`);
      resolve();
    });
    server.on("error", reject);
  });
}
