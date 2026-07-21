/**
 * Token resolver — fetches symbol/name/decimals for token addresses.
 * Priority: 1) DB cache → 2) DexScreener batch → 3) onchain eth_call fallback
 */
import { query } from "../db/index.js";
import { rpcClient } from "./rpc.js";
import { getTokens as dexGetTokens } from "./dexscreener.js";
import { logger } from "./logger.js";
import { erc20Abi } from "viem";

// In-memory cache (volatile, refreshes on process restart)
const symbolCache = new Map<string, string>();
const nameCache = new Map<string, string>();
const decimalsCache = new Map<string, number>();

export type TokenInfo = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
};

/**
 * Get token info for a single address
 */
export async function resolveToken(address: string): Promise<TokenInfo | null> {
  const addr = address.toLowerCase();
  if (symbolCache.has(addr)) {
    return {
      address: addr,
      symbol: symbolCache.get(addr)!,
      name: nameCache.get(addr) || addr.slice(0, 6),
      decimals: decimalsCache.get(addr) ?? 18,
    };
  }

  // 1. Try DB cache
  try {
    const { rows } = await query(
      `SELECT symbol, name, decimals FROM tokens WHERE LOWER(address) = $1`,
      [addr]
    );
    if (rows.length > 0 && rows[0].symbol) {
      const sym = rows[0].symbol;
      const nm = rows[0].name || addr.slice(0, 6);
      const dec = rows[0].decimals ?? 18;
      symbolCache.set(addr, sym);
      nameCache.set(addr, nm);
      decimalsCache.set(addr, dec);
      return { address: addr, symbol: sym, name: nm, decimals: dec };
    }
  } catch { /* DB may not have data yet */ }

  // 2. Try onchain via RPC
  try {
    const [symbol, name, decimals] = await Promise.all([
      rpcClient.readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
      rpcClient.readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: "name" }).catch(() => null),
      rpcClient.readContract({ address: addr as `0x${string}`, abi: erc20Abi, functionName: "decimals" }).catch(() => null),
    ]);

    const sym = String(symbol || "").slice(0, 12) || addr.slice(0, 6);
    const nm = String(name || "").slice(0, 24) || addr.slice(0, 6);
    const dec = Number(decimals ?? 18);

    symbolCache.set(addr, sym);
    nameCache.set(addr, nm);
    decimalsCache.set(addr, dec);

    // Persist to DB asynchronously
    persistToken(addr, sym, nm, dec).catch(() => {});
    
    return { address: addr, symbol: sym, name: nm, decimals: dec };
  } catch (err) {
    logger.warn(`[TokenResolver] onchain failed for ${addr}: ${err}`);
  }

  return null;
}

/**
 * Batch resolve — uses DexScreener batch endpoint for efficiency
 */
export async function resolveTokens(addresses: string[]): Promise<Map<string, TokenInfo>> {
  const unique = [...new Set(addresses.map(a => a.toLowerCase()))];
  const result = new Map<string, TokenInfo>();

  // Resolve one by one with caching
  const resolved = await Promise.allSettled(
    unique.map(addr => resolveToken(addr))
  );

  for (let i = 0; i < unique.length; i++) {
    const r = resolved[i];
    if (r.status === "fulfilled" && r.value) {
      result.set(unique[i], r.value);
    } else {
      // Fallback: use truncated address
      result.set(unique[i], {
        address: unique[i],
        symbol: unique[i].slice(0, 6),
        name: unique[i].slice(0, 6),
        decimals: 18,
      });
    }
  }

  return result;
}

/**
 * Quick symbol lookup — returns "SYMB" or truncated "0x1234..."
 */
export async function getSymbol(address: string): Promise<string> {
  const info = await resolveToken(address);
  return info?.symbol || address.slice(0, 6);
}

/**
 * Quick pair name — "SYMB1/SYMB2"
 */
export async function getPairName(token0: string, token1: string): Promise<string> {
  const [s0, s1] = await Promise.all([getSymbol(token0), getSymbol(token1)]);
  return `${s0}/${s1}`;
}

// ─── Internal ─────────────────────────────────

async function persistToken(address: string, symbol: string, name: string, decimals: number): Promise<void> {
  try {
    await query(
      `INSERT INTO tokens (chain_id, address, symbol, name, decimals, first_seen_at, updated_at)
       VALUES (4663, $1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (chain_id, address) DO UPDATE SET
         symbol = CASE WHEN tokens.symbol IS NULL THEN EXCLUDED.symbol ELSE tokens.symbol END,
         name = CASE WHEN tokens.name IS NULL THEN EXCLUDED.name ELSE tokens.name END,
         decimals = CASE WHEN tokens.decimals IS NULL THEN EXCLUDED.decimals ELSE tokens.decimals END,
         updated_at = NOW()`,
      [address, symbol, name, decimals]
    );
  } catch { /* background persistence — best effort */ }
}
