# Range Engine

## Output contract

Every recommendation must return:

```text
pair
protocol
pool_id_or_address
fee
hooks
strategy
current_price
lower_price
upper_price
tick_lower
tick_upper
deposit_asset
deposit_ratio
target_duration
review_interval
rebalance_trigger
probability_in_range_12h
probability_in_range_24h
probability_in_range_3d
probability_in_range_7d
median_time_to_exit
estimated_gross_fees
estimated_il
estimated_gas
estimated_net_result
confidence
```

## Data preparation

Use own 5-minute candles when available.

Calculate:

- Log returns.
- Realized volatility over 24h, 7d, and 30d.
- ATR.
- Trend and drift.
- Maximum drawdown.
- Jump frequency.
- Volume consistency.
- Liquidity distribution.
- External price deviation.

Reject ranges when candle coverage is poor or prices contain unresolved gaps.

## Candidate range generation

Generate multiple candidates instead of one formula:

### Active ranges

- Narrow: empirical move percentile around 55–70%.
- Balanced: empirical move percentile around 75–88%.
- Wide: empirical move percentile around 90–97%.

### One-sided ranges

#### BUY TOKEN BELOW

- Entire range below current price.
- Deposit only the quote asset.
- Candidate lower/upper levels based on pullback distribution, support zones, volatility, and liquidity bands.

#### SELL TOKEN ABOVE

- Entire range above current price.
- Deposit only the target token.
- Candidate lower/upper levels based on upside distribution, resistance zones, volatility, and liquidity bands.

Do not label a strategy only as “lower” or “upper”. Token ordering can invert the meaning.

## Mathematical seed

A normal-volatility seed may be used to generate candidates:

```text
lower = P × exp(-k × sigma × sqrt(H))
upper = P × exp(+k × sigma × sqrt(H))
```

But final selection must come from empirical backtesting, not this formula alone.

## Tick conversion

For each candidate:

1. Normalize token decimals.
2. Respect token0/token1 ordering.
3. Convert price to sqrt price.
4. Convert to tick.
5. Round lower tick down to valid tick spacing.
6. Round upper tick up to valid tick spacing.
7. Convert adjusted ticks back to human-readable prices.
8. Confirm the current tick and single-sided intent are correct.

Validate the adjusted price/tick pair through official Uniswap SDK logic or the Uniswap Liquidity API simulation.

## Backtest

Run walk-forward tests over available history.

For every candidate record:

- Time in range.
- Time to first exit.
- Number of re-entries.
- Fee estimate while active.
- IL versus hold.
- Net result after gas and rebalance assumptions.
- Maximum drawdown.
- Number of rebalances.
- Return distribution.
- Worst 5% outcome.

Probability outputs must be empirical:

```text
P(active after 12h)
P(active after 24h)
P(active after 3d)
P(active after 7d)
```

Do not present a seven-day probability when history is only six hours old.

## Fee estimate

A raw pool APR is not enough.

Estimate position fee share from:

- Actual swap fees.
- Active liquidity.
- Candidate liquidity.
- Tick traversal.
- Time in range.
- Fee tier or dynamic fee.
- Hook behavior.
- Expected volume by market session.

Output:

- gross fee estimate
- fee estimate confidence
- gas
- IL
- net result versus hold

## Stock Token handling

For Stock Tokens:

- Use Chainlink token price as reference.
- Read `uiMultiplier()`.
- Read `oraclePaused()`.
- Respect 24/5 feed updates.
- Add weekend/off-market gap scenarios.
- Detect earnings and corporate-action windows when external calendar data is available.
- Raise range width or reject fresh entry when reference price is stale.
- Compare token value, not raw underlying share price, because the multiplier can change.

## Range duration label

Use data-derived wording:

```text
Estimated active duration: 34–61 hours
Median historical exit: 47 hours
Suggested review: every 6 hours
Immediate review: price within 10% of boundary
```

Never output “good for three days” without the probabilities and sample size behind it.
