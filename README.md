# Robinhood Chain LP Radar — Live Build Starter Pack

Starter pack untuk membangun dashboard screening liquidity pool Robinhood Chain yang terus berjalan.

Target produk:

- Index semua pool Uniswap v2, v3, dan v4 di Robinhood Chain.
- Search pool lewat contract address.
- Ranking Top 10 setup LP yang benar-benar actionable.
- Menghasilkan range, tick, komposisi aset, target durasi, dan trigger rebalance.
- Menyimpan track record setiap rekomendasi lewat paper-LP.
- Memantau posisi wallet secara read-only.
- Tidak menyimpan private key dan tidak menandatangani transaksi.

## Prinsip data

Urutan kepercayaan data:

1. **Robinhood Chain RPC/WSS + state kontrak Uniswap** — source of truth.
2. **Chainlink feeds** — reference price utama, terutama Stock Tokens.
3. **Own indexed database** — history, candles, backtest, dan track record.
4. **CoinGecko Onchain** — backfill OHLCV, pool discovery, trades, holders.
5. **DEX Screener** — discovery cepat, metadata, liquidity/volume snapshot.
6. **Uniswap Liquidity API** — simulasi dan transaction preparation, bukan sumber ranking utama.

Jangan menjadikan DEX Screener atau CoinGecko sebagai satu-satunya sumber data. Keduanya aggregator dan bisa telat, tidak lengkap, atau belum sinkron dengan state terbaru.

## Build order

### Phase 1 — Data foundation

- RPC dan WebSocket health check.
- Backfill deployment block kontrak Uniswap.
- Index event pool, swap, mint/burn/modify liquidity.
- Simpan token, pool, snapshot, candle, dan tick liquidity.
- Implement search by contract address.

### Phase 2 — Screener

- Pool safety filters.
- Score 0–100.
- Ranking Top 10.
- Deduplication agar satu token tidak memenuhi dashboard.
- Data-confidence score.

### Phase 3 — Range engine

- Realized volatility.
- Empirical backtest.
- Stay-in-range probability.
- Median time-to-exit.
- Narrow, wide, buy-below, dan sell-above setup.
- Exact ticks dan deposit ratio.

### Phase 4 — Tracking

- Paper-LP otomatis untuk setiap rekomendasi.
- Position monitor.
- PnL versus hold.
- Fee, IL, time in range, dan rebalance history.
- Alert.

## Quick start

```bash
cp .env.example .env
docker compose up -d

npm install
npm run verify:sources
```

Setelah semua source hijau:

```bash
npm run dev
```

Project ini belum berisi dashboard Next.js final. Isinya adalah data architecture, configuration, database schema, API clients, dan build prompt agar Codex tidak mulai dari nol atau ngarang source.

## File penting

- `PROMPT_HERMES_CODEX.md` — prompt utama untuk builder.
- `docs/DATA_SOURCES.md` — API dan pembagian tanggung jawab data.
- `docs/CHAIN_CONTRACTS.md` — kontrak resmi Robinhood Chain dan Uniswap.
- `docs/LIVE_PIPELINE.md` — worker dan refresh cadence.
- `docs/RANGE_ENGINE.md` — aturan range dan backtest.
- `docs/DASHBOARD_SPEC.md` — UI dashboard.
- `sql/schema.sql` — schema PostgreSQL/TimescaleDB.
- `config/scoring.json` — bobot ranking.
- `config/alerts.json` — trigger alert.
- `scripts/verify-data-sources.ts` — test koneksi API.
