"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { wagmiAdapter } from "../lib/config";
import { sepolia } from "@reown/appkit/networks";
import { ToastProvider } from "../context/ToastContext";
import ToastContainer from "../components/ToastContainer";
import { type ReactNode, useState, useEffect } from "react";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "YOUR_REOWN_PROJECT_ID";

// AppKit singleton — created once at module level
createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [sepolia],
  defaultNetwork: sepolia,
  metadata: {
    name: "NFT Marketplace",
    description: "ERC20-powered NFT marketplace on Sepolia testnet",
    url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    icons: [],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
});

export function Providers({ children, initialState }: { children: ReactNode; initialState?: unknown }) {
  const [queryClient] = useState(() => new QueryClient());
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig} initialState={initialState as never}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {mounted && children}
          <ToastContainer />
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
