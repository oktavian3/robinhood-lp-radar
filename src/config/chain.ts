import { defineChain } from "viem";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        process.env.ROBINHOOD_RPC_URL ??
          "https://rpc.mainnet.chain.robinhood.com",
      ],
      webSocket: process.env.ROBINHOOD_WSS_URL
        ? [process.env.ROBINHOOD_WSS_URL]
        : undefined,
    },
    public: {
      http: ["https://rpc.mainnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});
