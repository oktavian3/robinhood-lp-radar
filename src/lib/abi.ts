import { parseAbi } from "viem";

export const V2_FACTORY_ABI = parseAbi([
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)"
]);

export const V2_PAIR_ABI = parseAbi([
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
  "event Mint(address indexed sender, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)",
  "event Sync(uint112 reserve0, uint112 reserve1)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)",
]);

export const V3_FACTORY_ABI = parseAbi([
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"
]);

export const V3_POOL_ABI = parseAbi([
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
]);

export const V4_POOLMANAGER_ABI = parseAbi([
  "event Initialize(address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, bytes32 hooks, bytes32 poolId)",
  "event Swap(address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, bytes32 hooks, bytes32 poolId, address indexed sender, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  "event ModifyLiquidity(bytes32 indexed poolId, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta)",
]);
