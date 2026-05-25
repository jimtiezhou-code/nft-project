import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { cookieToInitialState } from "wagmi";
import { wagmiConfig } from "../lib/config";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "NFT Marketplace — Sepolia",
  description: "ERC20-powered NFT marketplace on Sepolia testnet",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers();
  const initialState = cookieToInitialState(wagmiConfig, hdrs.get("cookie"));

  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 min-h-screen">
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}
