/**
 * Telegram Bot — Robinhood LP Radar commands
 * Commands: /top, /list, /screen, /scan <address>, /health, /track
 */
import { Bot, InlineKeyboard } from "grammy";
import { getTopPools } from "../engine/scoring.js";
import { getPoolCounts, getPoolByAddress, getPoolByTokens, getSourceHealth } from "../db/index.js";
import { getSymbol, getPairName, resolveTokens } from "../lib/token-resolver.js";
import { evaluateRangeForPool } from "../engine/range-engine.js";
import { getTrackRecord } from "../engine/paper-tracker.js";
import { logger } from "../lib/logger.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USERS = (process.env.TELEGRAM_ALLOWED_USERS || "").split(",").map(s => s.trim()).filter(Boolean);

let bot: Bot | null = null;

function isAllowed(userId: number): boolean {
  if (ALLOWED_USERS.length === 0) return true; // allow all if not configured
  return ALLOWED_USERS.includes(String(userId));
}

function sn(a: string | null | undefined): string {
  return !a || a.length < 20 ? a || "--" : a.slice(0, 6) + "..." + a.slice(-4);
}

export async function startTelegramBot(): Promise<void> {
  if (!TOKEN) {
    logger.warn("[TelegramBot] No TELEGRAM_BOT_TOKEN set — skipping");
    return;
  }

  logger.info(`[TelegramBot] Initializing with token: ${TOKEN.slice(0, 8)}...`);
  bot = new Bot(TOKEN);

  // ─── Middleware ──────────────────────────────
  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid && !isAllowed(uid)) {
      await ctx.reply("⛔ Unauthorized. You're not on the allowed list.");
      return;
    }
    await next();
  });

  // ─── /start ─────────────────────────────────
  bot.command("start", async (ctx) => {
    await ctx.reply(
      `🤖 *Robinhood LP Radar Bot*\n\n` +
      `Screen liquidity pools on Robinhood Chain (ID: 4663)\n\n` +
      `*Commands:*\n` +
      `/top — Top 10 ranked pools\n` +
      `/list — Pool stats (total/eligible/rejected)\n` +
      `/health — Data source health\n` +
      `/scan \`<address>\` — Scan pool or token address\n` +
      `/track — Track record & performance\n` +
      `/help — This message\n\n` +
      `_Data refreshes every 15 seconds_`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `*Commands:*\n` +
      `/top — Top 10 ranked pools with score & risk\n` +
      `/list — Pool count, eligible, rejected by protocol\n` +
      `/health — RPC, DexScreener, Chainlink status\n` +
      `/scan \`0x...\` — Search pool or token, shows ranges\n` +
      `/track — Win rate, avg net, strategy breakdown\n` +
      `/help — This message`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /top ───────────────────────────────────
  bot.command("top", async (ctx) => {
    await ctx.reply("🔍 Fetching Top 10 rankings...");
    try {
      const top = await getTopPools(10, 0);
      if (top.length === 0) {
        await ctx.reply("📊 *Top Rankings*\n\nNo pools scored yet — backfill masih jalan. Coba lagi nanti.", { parse_mode: "Markdown" });
        return;
      }

      // Resolve symbols
      const allTokens = new Set<string>();
      for (const p of top) { allTokens.add(p.token0); allTokens.add(p.token1); }
      const tokenMap = await resolveTokens([...allTokens]);

      const lines = top.map((p, i) => {
        const sym0 = tokenMap.get(p.token0.toLowerCase())?.symbol || sn(p.token0);
        const sym1 = tokenMap.get(p.token1.toLowerCase())?.symbol || sn(p.token1);
        const flags = (p.riskFlags || []).filter(f => f !== "FILTERED").join(",");
        return `${i + 1}. *${sym0}*/*${sym1}* (${p.protocol})\n` +
               `   Score: ${p.score}/100 · Conf: ${p.confidence}%\n` +
               `   Risk: ${p.riskLevel} ${flags ? "· ⚠️ " + flags : ""}`;
      }).join("\n\n");

      await ctx.reply(`📊 *Top 10 Pools*\n\n${lines}`, { parse_mode: "Markdown" });
    } catch (err: any) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // ─── /list ──────────────────────────────────
  bot.command("list", async (ctx) => {
    try {
      const counts = await getPoolCounts();
      await ctx.reply(
        `📋 *Robinhood Chain Pool Stats*\n\n` +
        `Total: ${counts.total}\n` +
        `Active: ${counts.eligible}\n` +
        `Rejected: ${counts.rejected}\n\n` +
        `*By Protocol:*\n` +
        `${Object.entries(counts.byProtocol).map(([k, v]) => `• ${k}: ${v}`).join("\n")}`,
        { parse_mode: "Markdown" }
      );
    } catch (err: any) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // ─── /health ────────────────────────────────
  bot.command("health", async (ctx) => {
    try {
      const health = await getSourceHealth();
      const lines = health.map(s => {
        const ok = s.last_success_at && !s.last_error && s.consecutive_failures < 3;
        const icon = ok ? "✅" : s.consecutive_failures >= 3 ? "🔴" : s.last_success_at ? "🟡" : "⚪";
        const lag = s.data_lag_seconds ? ` (lag: ${s.data_lag_seconds}s)` : "";
        return `${icon} *${s.source_id}*${lag}\n   ${ok ? "OK" : s.last_error || "pending"}`;
      }).join("\n\n");
      await ctx.reply(`🏥 *Data Source Health*\n\n${lines}`, { parse_mode: "Markdown" });
    } catch (err: any) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // ─── /scan <address> ────────────────────────
  bot.command("scan", async (ctx) => {
    const addr = ctx.match?.trim();
    if (!addr || addr.length < 20) {
      await ctx.reply(
        "❌ Kasih address yang bener.\n\n" +
        "Contoh: `/scan 0x8f100e99ddf699320724e37cb866770381d47382`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await ctx.reply(`🔍 Scanning \`${addr.slice(0, 10)}...\`...`, { parse_mode: "Markdown" });

    try {
      // Try pool address first
      let pool = await getPoolByAddress(addr);

      if (pool) {
        // Pool found
        const sym0 = await getSymbol(pool.token0);
        const sym1 = await getSymbol(pool.token1);
        const ranges = await evaluateRangeForPool(pool.id);

        let msg = `🔎 *Pool Ditemukan*\n\n` +
          `${sym0} / ${sym1}\n` +
          `${pool.protocol} · Fee: ${pool.fee ? pool.fee / 10000 + "%" : "N/A"}\n` +
          `Status: ${pool.status}\n` +
          `Address: \`${sn(pool.pool_address)}\``;

        if (ranges.length > 0) {
          msg += "\n\n📐 *Range Setups:*";
          ranges.slice(0, 3).forEach((r, i) => {
            msg += `\n\n${i + 1}. *${r.candidate.label}*\n` +
              `   Range: ${r.candidate.lowerPrice} - ${r.candidate.upperPrice}\n` +
              `   Ticks: \`${r.candidate.tickLower}/${r.candidate.tickUpper}\`\n` +
              `   🎯 24h prob: ${Math.round(r.prob24h * 100)}%\n` +
              `   💰 Net: $${r.estimatedNetUsd.toFixed(2)} (conf: ${r.confidence}%)`;
          });
        } else {
          msg += "\n\n⏳ Waiting for candle data...";
        }

        await ctx.reply(msg, { parse_mode: "Markdown" });
      } else {
        // Try token
        const tokenPools = await getPoolByTokens(addr, addr);
        const tokenSym = await getSymbol(addr);

        if (tokenPools.length === 0) {
          await ctx.reply(`❌ No pools found for \`${addr.slice(0, 10)}...\``, { parse_mode: "Markdown" });
          return;
        }

        // Resolve all symbols
        const allTokens = new Set<string>();
        for (const p of tokenPools) { allTokens.add(p.token0); allTokens.add(p.token1); }
        const tokenMap = await resolveTokens([...allTokens]);

        const lines = tokenPools.map(p => {
          const s0 = tokenMap.get(p.token0.toLowerCase())?.symbol || sn(p.token0);
          const s1 = tokenMap.get(p.token1.toLowerCase())?.symbol || sn(p.token1);
          return `• ${p.protocol} · *${s0}*/*${s1}*\n  fee: ${p.fee ? p.fee / 10000 + "%" : "N/A"} · status: ${p.status}`;
        }).join("\n\n");

        await ctx.reply(
          `🔎 *${tokenSym}*\n${tokenPools.length} pools ditemukan\n\n${lines}`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (err: any) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // ─── /track ─────────────────────────────────
  bot.command("track", async (ctx) => {
    try {
      const record = await getTrackRecord(30);
      if (!record || record.totalRecommendations === 0) {
        await ctx.reply("📈 *Track Record*\n\nBelum ada rekomendasi yang di-track. Tunggu setelah scoring aktif.", { parse_mode: "Markdown" });
        return;
      }

      let msg = `📈 *Track Record* (30 hari)\n\n` +
        `Total Rekomendasi: ${record.totalRecommendations}\n` +
        `Win Rate vs Hold: ${Math.round((record.winRate || 0) * 100)}%\n` +
        `Avg Fee: $${(record.avgFee || 0).toFixed(2)}\n` +
        `Avg IL: $${(record.avgIl || 0).toFixed(2)}\n` +
        `Avg Net: $${(record.avgNet || 0).toFixed(2)}`;

      if (record.performanceByStrategy) {
        msg += "\n\n*By Strategy:*";
        for (const [strat, data] of Object.entries(record.performanceByStrategy)) {
          const d = data as any;
          msg += `\n• ${strat}: ${d.count} pos · ${d.wins}/${d.count} wins · net $${(d.net || 0).toFixed(2)}`;
        }
      }

      await ctx.reply(msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // ─── Launch ─────────────────────────────────
  let pollError: Error | null = null;
  bot.catch((err) => {
    logger.error(`[TelegramBot] Handler error: ${err.message} — ctx: ${err.ctx?.update?.message?.text || "unknown"}`);
    pollError = err;
  });

  // Start polling with error handling
  bot.start({ 
    drop_pending_updates: true, 
  }).catch((err: any) => {
    logger.error(`[TelegramBot] Start failed: ${err.message || err}`);
    pollError = err instanceof Error ? err : new Error(String(err));
  });

  // If polling failed to start, log it
  setTimeout(() => {
    if (pollError) {
      logger.error(`[TelegramBot] Bot is NOT running — polling error: ${pollError.message}`);
    } else {
      logger.info("[TelegramBot] Bot started — waiting for commands");
    }
  }, 2000);
}

export function stopTelegramBot(): void {
  if (bot) {
    bot.stop();
    logger.info("[TelegramBot] Stopped");
  }
}
