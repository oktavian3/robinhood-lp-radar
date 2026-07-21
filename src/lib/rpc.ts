import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
} from "viem";
import { robinhoodChain } from "../config/chain.js";

const rpcUrl =
  process.env.ROBINHOOD_RPC_URL ??
  "https://rpc.mainnet.chain.robinhood.com";

export const rpcClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(rpcUrl, {
    timeout: 20_000,
    retryCount: 3,
    retryDelay: 1_000,
  }),
  batch: {
    multicall: true,
  },
});

export const wsClient = process.env.ROBINHOOD_WSS_URL
  ? createPublicClient({
      chain: robinhoodChain,
      transport: webSocket(process.env.ROBINHOOD_WSS_URL, {
        reconnect: true,
        timeout: 20_000,
      }),
    })
  : undefined;

export async function assertRobinhoodChain(): Promise<void> {
  const chainId = await rpcClient.getChainId();
  if (chainId !== 4663) {
    throw new Error(`Wrong RPC chain ID: expected 4663, received ${chainId}`);
  }

  const block = await rpcClient.getBlockNumber();
  if (block <= 0n) {
    throw new Error("RPC returned an invalid latest block.");
  }
}
