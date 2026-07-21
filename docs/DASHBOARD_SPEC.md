# Dashboard Specification

## 1. Overview

### Top 10 table

Columns:

- Rank.
- Pair.
- Protocol.
- Fee.
- Strategy.
- Current price.
- Range.
- Deposit asset.
- Target duration.
- 24h stay probability.
- Net result estimate.
- Score.
- Confidence.
- Risk.
- Last updated.
- Action.

Actions:

- View analysis.
- Copy exact setup.
- Add paper position.
- Watch.
- Open explorer.
- Open Uniswap.

Badges:

- NEW
- UP/DOWN rank
- RANGE CHANGED
- DATA DEGRADED
- ORACLE PAUSED
- OUT OF RANGE

### Market health

- Indexed pools.
- Eligible pools.
- Rejected pools.
- 24h DEX volume.
- Current source lag.
- Worker health.
- Latest indexed block.

## 2. Search by CA

Input accepts:

- Token contract.
- v2/v3 pool address.
- v4 pool ID.
- Symbol/name.

Results:

1. All discovered pools.
2. Quote asset.
3. Protocol and fee.
4. TVL, volume, swaps, age.
5. Verified and risk status.
6. Best three setups.
7. Rejection reasons.

## 3. Pool detail

- Price chart.
- Chainlink/reference overlay.
- Liquidity distribution chart.
- Current tick.
- Fee and volume history.
- LP additions/removals.
- Holder concentration.
- Pool and token risk flags.
- Strategy candidate comparison.
- Backtest results.

## 4. Range planner

Inputs:

- Pool.
- Capital.
- Asset owned.
- Intent.
- Target horizon.
- Maximum rebalance frequency.
- Risk mode.

Intents:

- Earn fees around current price.
- Buy token below.
- Sell token above.

Outputs:

- Exact range and ticks.
- Adjusted range after tick spacing.
- Token amounts.
- Estimated duration.
- Probabilities.
- Fee, IL, gas, net.
- Copy setup.
- Uniswap simulation.

## 5. Position monitor

- Read-only wallet connect.
- Wallet address input.
- NFT token ID input.
- Paper position.

Display:

- Current value.
- Token amounts.
- Fees.
- IL.
- PnL versus hold.
- Time in range.
- Boundary distance.
- Next review.
- Rebalance history.

## 6. Recommendation track record

This page is mandatory.

Show aggregate results:

- Published recommendations.
- Win rate versus hold.
- Average time in range.
- Average fee.
- Average IL.
- Average net result.
- Range exit rate by strategy.
- Performance by confidence bucket.
- Performance by pool age.

A dashboard without historical accountability is just an APR billboard.
