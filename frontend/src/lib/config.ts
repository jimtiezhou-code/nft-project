import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia } from "@reown/appkit/networks";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "YOUR_REOWN_PROJECT_ID";

// 指定 Sepolia RPC（避免 wagmi 默认公共节点限流）
const sepoliaRpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [sepolia],
  customRpcUrls: {
    "eip155:11155111": [{ url: sepoliaRpc }],
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
