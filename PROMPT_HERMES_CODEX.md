# Master Prompt for Hermes + Codex

Build a production-oriented, continuously running Robinhood Chain LP Screener and Range Planner.

Read every file in this starter pack before coding.

## Non-negotiable rules

1. Direct Robinhood Chain RPC and Uniswap contract state are the source of truth.
2. DEX Screener and CoinGecko are secondary and must never overwrite fresher onchain data.
3. Range calculation must be deterministic and backtested.
4. LLM text can explain results but may not invent numbers.
5. Every published recommendation must be paper-tracked.
6. MVP is read-only.
7. Never request, store, log, or transmit a private key.
8. Never auto-sign or broadcast LP transactions.
9. Show data age and confidence on every recommendation.
10. Report unsupported data and assumptions honestly.

## Start here

1. Read:
   - `docs/CHAIN_CONTRACTS.md`
   - `docs/DATA_SOURCES.md`
   - `docs/LIVE_PIPELINE.md`
   - `docs/RANGE_ENGINE.md`
   - `docs/DASHBOARD_SPEC.md`
   - `sql/schema.sql`
   - all files in `config/`

2. Run:
   - `npm install`
   - `docker compose up -d`
   - `npm run verify:sources`

3. Confirm:
   - RPC chain ID is 4663.
   - Archive access works.
   - WebSocket logs work.
   - Contract bytecode exists at every configured address.
   - DEX Screener recognizes chain slug `robinhood`.
   - CoinGecko recognizes network ID `robinhood`.
   - Uniswap API key works.

Do not continue with production code when a required source is unresolved.

## Product requirements

### Global Top 10

A recommendation is:

```text
POOL + FEE + STRATEGY + RANGE + DEPOSIT ASSET + TARGET DURATION
```

Each card must contain:

- Pair and token contracts.
- Pool address or v4 pool ID.
- Protocol.
- Fee/tick spacing/hooks.
- Current price.
- Reference price and deviation.
- Strategy.
- Lower/upper price.
- Lower/upper tick.
- Deposit asset and ratio.
- Target active duration.
- Stay-in-range probabilities.
- Expected review and rebalance frequency.
- Gross fees.
- IL.
- Gas.
- Net result versus hold.
- Score.
- Confidence.
- Risk flags.
- Data timestamps.
- Copy setup.
- Paper-track action.
- Open explorer.
- Open Uniswap.

### Search by contract address

- Validate EVM address.
- Find v2, v3, and v4 pools.
- Search direct onchain first.
- Cross-check DEX Screener and CoinGecko.
- Rank all fee tiers and quote assets.
- Return the three best setups.
- Show why other pools were rejected.

### Strategy types

Use only these human-facing labels:

- `EARN FEES AROUND CURRENT PRICE`
- `BUY TOKEN BELOW`
- `SELL TOKEN ABOVE`

Internally narrow/wide variants may exist.

Never expose only `lower`, `upper`, `token0`, or `token1` as the strategy meaning.

### Position monitor

Support:

- Read-only wallet address.
- v3/v4 NFT token ID.
- Paper position.

Track:

- Amounts.
- Value.
- Fees.
- IL.
- Hold benchmark.
- Time in range.
- Boundary distance.
- Rebalance history.
- Net PnL.

## Data implementation

### RPC/WSS

Use viem.

- WebSocket for live logs.
- HTTP archive RPC for backfill and reconciliation.
- Cursor every indexed contract.
- Idempotency: `(chain_id, tx_hash, log_index)`.
- Reorg-aware block storage.
- Never depend only on subscriptions.

### Uniswap v2

- Factory `PairCreated`.
- Pair `Swap`, `Mint`, `Burn`, `Sync`.
- Reserves and LP supply.

### Uniswap v3

- Factory `PoolCreated`.
- Pool `Initialize`, `Swap`, `Mint`, `Burn`, `Collect`.
- `slot0`, active liquidity, fee growth, ticks.
- Positions through NFT manager.

### Uniswap v4

- PoolManager `Initialize`, `Swap`, `ModifyLiquidity`.
- Normalize PoolKey and PoolId.
- Use StateView for state reads.
- Inspect hooks and reject unknown hooks by default.
- Support dynamic fee data.

### DEX Screener

Use for:

- Quick discovery.
- Metadata.
- Pair links.
- Snapshot cross-check.

Respect documented rate limits and cache responses.

### CoinGecko Onchain

Use network ID `robinhood`.

Use for:

- Top/new/token pools.
- OHLCV backfill.
- Trades.
- Holder concentration.
- Metadata.

Every imported value must retain source and fetch timestamp.

### Chainlink

For Stock Tokens:

- Feed price.
- Feed decimals.
- Updated timestamp.
- Heartbeat.
- Sequencer uptime.
- `uiMultiplier`.
- `oraclePaused`.

Reject new recommendations when reference data is stale or paused.

### Uniswap API

Use for simulation and unsigned transaction preparation.

- `/lp/create`
- `/lp/create_classic`
- `/lp/increase`
- `/lp/decrease`
- `/lp/claim`

The dashboard may prepare calldata, but signing remains entirely inside the user's wallet.

## Scoring and range

Load defaults from `config/scoring.json`.

Do not hardcode thresholds in UI code.

Generate several candidate ranges and backtest them. Publish empirical probabilities and sample size.

Use data-confidence penalties for young pools. A new pool with huge APR must not outrank an older pool just because it has six minutes of volume.

## Paper tracking

When a recommendation enters Top 10:

- Create immutable recommendation version.
- Create paper position using the suggested capital.
- Store benchmark starting amounts.
- Continue tracking after it leaves Top 10.
- Do not rewrite historical values after recalculation.

Dashboard must show performance for 7D and 30D recommendation cohorts.

## Build phases

### Phase 1

- Database and migrations.
- RPC/WSS health.
- Pool discovery and search.
- Source-health dashboard.
- Raw event storage.
- Screenshots and tests.

### Phase 2

- Candle builder.
- Tick liquidity.
- Oracle worker.
- Eligibility filters.
- Top 10 scoring.
- Screenshots and tests.

### Phase 3

- Range engine.
- Backtests.
- Copy exact setup.
- Uniswap simulation.
- Screenshots and tests.

### Phase 4

- Paper tracking.
- Position monitor.
- Alerts.
- Track-record page.
- Screenshots and tests.

After every phase output:

- What was built.
- Test results.
- Screenshot paths.
- Missing source coverage.
- Assumptions.
- Known incorrect or incomplete metrics.
- Next exact tasks.

Do not claim completion until source verification, unit tests, integration tests, and live data screenshots pass.
