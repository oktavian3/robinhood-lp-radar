# Chain and Contract Configuration

Verified on: **2026-07-21**

## Robinhood Chain

| Property | Value |
|---|---|
| Chain ID | `4663` |
| Gas token | `ETH` |
| Recommended RPC | `https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}` |
| Recommended WSS | `wss://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}` |
| Public fallback | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |

Production indexing needs a dedicated provider and archive access. Public RPC should only be fallback or development access.

## Uniswap v2

| Contract | Address |
|---|---|
| Factory | `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f` |
| Router02 | `0x89e5db8b5aa49aa85ac63f691524311aeb649eba` |

Index:

- Factory `PairCreated`.
- Pair `Swap`, `Mint`, `Burn`, `Sync`.
- `getReserves()`, `totalSupply()`, token balances, and LP balances.

## Uniswap v3

| Contract | Address |
|---|---|
| Factory | `0x1f7d7550b1b028f7571e69a784071f0205fd2efa` |
| Interface Multicall | `0x282a3c4d320cc7f0d5eaf56b8029e4b88338f0a3` |
| TickLens | `0x7dfd4f31be6814d2906bde155c3e1b146eac1468` |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` |
| NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` |

Index:

- Factory `PoolCreated`.
- Pool `Initialize`, `Swap`, `Mint`, `Burn`, `Collect`, `Flash`.
- `slot0()`, `liquidity()`, `feeGrowthGlobal0X128()`, `feeGrowthGlobal1X128()`.
- Initialized ticks through `TickLens` or direct tick reads.
- Position NFT data through `NonfungiblePositionManager.positions(tokenId)`.

## Uniswap v4

| Contract | Address |
|---|---|
| PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| PositionDescriptor | `0x9639443158e8c5efa35bd45287bf2effd3d8dc06` |
| PositionManager | `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |
| StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| ReservesLens | `0x0000001b173C3bbF3984D417d8614E3eed34865B` |
| Universal Router | `0x8876789976decbfcbbbe364623c63652db8c0904` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

v4 uses a singleton `PoolManager`; a pool is identified by a `PoolId`, not a standalone pool contract address.

Store:

- `currency0`
- `currency1`
- `fee`
- `tickSpacing`
- `hooks`
- `poolId`

Index `Initialize`, `Swap`, `ModifyLiquidity`, and fee-related events from `PoolManager`. Always validate hook code and permissions before allowing the pool into recommendations.

## Chainlink

Data Streams verifier proxy:

`0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7`

Feed proxy addresses must be loaded from the current Chainlink Robinhood registry. Do not freeze feed addresses inside application code.

For every price read:

- Call `decimals()`.
- Read `latestRoundData()`.
- Reject zero or negative answers.
- Reject stale `updatedAt`.
- Check L2 sequencer uptime.
- For Stock Tokens, read `uiMultiplier()` and `oraclePaused()`.
