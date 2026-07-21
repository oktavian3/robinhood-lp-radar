# Live Data Pipeline

## Worker layout

### A. Block cursor worker

Runs continuously.

Responsibilities:

- Follow latest Robinhood Chain blocks.
- Persist block number, hash, parent hash, and timestamp.
- Detect gaps and enqueue backfill jobs.
- Detect replaced block hashes and invalidate affected derived data.

### B. Pool discovery worker

Sources:

- v2 Factory `PairCreated`.
- v3 Factory `PoolCreated`.
- v4 PoolManager `Initialize`.
- DEX Screener token/pair endpoints.
- CoinGecko new pools and top pools.

Output:

- Normalized pool record.
- Token records.
- Initial safety state.
- Backfill range.
- Protocol-specific identifiers.

Schedule:

- Events: continuously.
- Aggregator discovery cross-check: every 15 minutes.
- Full reconciliation: every 6 hours.

### C. Swap and liquidity event worker

Store raw normalized events:

- Swap.
- Mint/Burn.
- ModifyLiquidity.
- Collect.
- Sync.
- Hook metadata where applicable.

Then update:

- Current price.
- Current tick.
- Active liquidity.
- Volume buckets.
- Trader counts.
- LP additions/removals.

### D. Candle builder

Build candles from own swap events:

- 1 minute.
- 5 minute.
- 1 hour.
- 1 day.

OHLCV must include:

- open
- high
- low
- close
- base volume
- quote volume
- USD volume
- trade count
- unique traders
- source coverage ratio

Use CoinGecko only to backfill missing windows. Mark backfilled candles separately.

### E. Tick liquidity worker

v3:

- Read initialized ticks around current price.
- Refresh after Mint/Burn.
- Periodic full reconciliation.

v4:

- Use StateView and PoolManager state.
- Refresh after ModifyLiquidity.
- Record hooks and dynamic fees.

Output:

- liquidity by tick.
- liquidity within ±1%, ±2%, ±5%, ±10%.
- concentration score.
- slippage estimates.

### F. Oracle worker

Read Chainlink reference data:

- answer
- decimals
- updatedAt
- heartbeat
- sequencer status
- oraclePaused
- uiMultiplier
- pending multiplier/effective time when available

Stock Token rules:

- Feed can update 24/5.
- Weekend/off-market state is explicit.
- Corporate-action pause is explicit.
- Never pretend a stale Friday price is a fresh Sunday reference.

### G. Ranking worker

Every 15 minutes:

1. Select eligible pools.
2. Calculate market metrics.
3. Generate strategy candidates.
4. Backtest candidate ranges.
5. Calculate score and confidence.
6. Deduplicate.
7. Publish Top 10.
8. Start or update paper tracking.

Every hour:

- Full metric and range refresh.

Every 24 hours:

- Long-window backtests.
- Recalibrate volatility.
- Review false-positive and range-exit history.

### H. Position worker

Every 5 minutes:

- Read position state.
- Recalculate token amounts.
- Update accrued fees.
- Compare against hold benchmark.
- Measure distance to range boundaries.
- Trigger alert.

## Queue names

```text
blocks.live
blocks.backfill
pools.discover
pools.reconcile
events.decode
candles.build
ticks.refresh
oracles.refresh
ranking.fast
ranking.full
backtest.daily
positions.refresh
alerts.dispatch
source.health
```

## Data freshness shown in UI

Every recommendation card must show:

```text
Onchain state: 8s ago
Reference price: 22s ago
OHLCV: 1m ago
Ranking calculated: 4m ago
History coverage: 7.3 days
Confidence: 91%
```

A green dot with unknown data age is decorative nonsense. Show timestamps.
