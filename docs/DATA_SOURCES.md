# Data Sources

## Recommended stack

### 1. Robinhood Chain RPC and WebSocket

**Use for**

- Blocks and timestamps.
- Contract events.
- Current pool state.
- Current tick and liquidity.
- Wallet positions.
- Token metadata read directly from contracts.
- Reconciliation after missed WebSocket messages.

**Cadence**

- WSS: every block/event.
- RPC reconciliation: every 1–5 minutes.
- Historical backfill: archive RPC.

**Rules**

- Store block number, block hash, tx hash, and log index.
- Use idempotent inserts.
- Detect reorgs even if rare.
- Keep a cursor per contract/event stream.
- Never trust only a long-lived WebSocket connection.

### 2. Chainlink Price Feeds

**Use for**

- Reference price.
- Pool-price deviation.
- Stock Token price.
- Oracle health.
- Corporate-action aware valuation.

Stock Token feeds follow 24/5 updates. During corporate actions feeds may pause. Dashboard must show `REFERENCE PRICE UNAVAILABLE` instead of reusing a stale value.

### 3. DEX Screener API

Base:

```text
https://api.dexscreener.com
```

Robinhood chain slug:

```text
robinhood
```

Useful endpoints:

```text
GET /latest/dex/search?q={query}
GET /latest/dex/pairs/robinhood/{pairId}
GET /token-pairs/v1/robinhood/{tokenAddress}
GET /tokens/v1/robinhood/{commaSeparatedTokenAddresses}
```

Rate limits documented by DEX Screener:

- Pair/search/token endpoints: `300 requests/minute`.
- Profile/boost endpoints: `60 requests/minute`.

**Use for**

- Fast contract-address search.
- Pair discovery cross-check.
- Liquidity and volume snapshot.
- Website/social metadata.
- Pair creation timestamp.
- User-facing DEX Screener link.

**Do not use for**

- Exact tick.
- Active liquidity.
- Tick distribution.
- LP fees owed.
- Range calculations.
- Final pool safety verdict.

Cache token-pair results for 30–60 seconds. Use exponential backoff and respect `429`.

### 4. CoinGecko Onchain API

Network ID:

```text
robinhood
```

Recommended base:

```text
https://pro-api.coingecko.com/api/v3
```

Useful endpoints:

```text
GET /onchain/networks/robinhood/pools
GET /onchain/networks/robinhood/new_pools
GET /onchain/networks/robinhood/tokens/{token}/pools
GET /onchain/networks/robinhood/pools/{pool}/info
GET /onchain/networks/robinhood/pools/{pool}/ohlcv/{timeframe}
GET /onchain/networks/robinhood/pools/{pool}/trades
GET /onchain/networks/robinhood/tokens/{token}/top_holders
GET /onchain/networks/robinhood/tokens/{token}/holders_chart
GET /onchain/search/pools?query={query}&network=robinhood
```

**Use for**

- Initial pool backfill.
- Historical OHLCV when own indexer has not collected enough data.
- Last trades cross-check.
- Holder concentration.
- Token/pool metadata.
- New-pool discovery fallback.

**Rules**

- Tag every imported field with `source=coingecko`.
- Store `fetched_at`.
- Do not overwrite newer onchain-derived values.
- Normalize pool IDs carefully: v4 pool IDs may be represented differently from normal EVM addresses.
- Plans and endpoint limits differ; dashboard must degrade cleanly if an endpoint is unavailable.

### 5. Uniswap API

Trade API:

```text
https://trade-api.gateway.uniswap.org/v1
```

Liquidity API:

```text
https://liquidity.api.uniswap.org
```

Relevant endpoints:

```text
POST /lp/create
POST /lp/create_classic
POST /lp/increase
POST /lp/decrease
POST /lp/claim
POST /quote
```

All require `x-api-key`.

Robinhood Chain is chain ID `4663`. Universal Router on Robinhood Chain uses version `2.1.1`; set this explicitly where the endpoint accepts the router-version header.

**Use for**

- Validate calculated price bounds against tick-adjusted bounds.
- Gas simulation.
- Prepare unsigned transaction calldata.
- Deep-link or wallet-assisted flow.
- Swap quotes used only as a secondary market-depth check.

**Do not use for**

- Autonomous execution.
- Storing private keys.
- Replacing own deterministic range engine.
- Ranking pools by API response alone.

## Data ownership table

| Field | Primary | Secondary |
|---|---|---|
| Current tick | RPC/Uniswap state | None |
| Active liquidity | RPC/Uniswap state | Aggregator snapshot |
| Pool fee/tick spacing/hooks | Factory/PoolManager | Uniswap deployment metadata |
| Swap events | RPC logs | CoinGecko trades |
| Current pool price | RPC state | DEX Screener/CoinGecko |
| Reference price | Chainlink | Best external market source |
| 5m OHLCV | Own event aggregation | CoinGecko backfill |
| 24h volume | Own aggregation | DEX Screener/CoinGecko |
| Holder concentration | RPC/indexer | CoinGecko holders |
| Contract verification | Explorer/onchain bytecode | Aggregator risk flags |
| Exact LP ticks | Own range engine + SDK | Uniswap API validation |
| Gas estimate | RPC simulation | Uniswap API simulation |

## Source-health requirements

Every source must write:

- `last_success_at`
- `last_failure_at`
- `last_error`
- `latency_ms`
- `consecutive_failures`
- `data_lag_seconds`

Recommendations cannot be published when:

- RPC data is stale.
- Chainlink reference price is stale for a strategy requiring it.
- Pool history is below the minimum confidence threshold.
- Data sources disagree beyond configured tolerances.
