"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import ConnectButton from "../components/ConnectButton";
import MarketplaceGrid from "../components/MarketplaceGrid";
import ListNFTForm from "../components/ListNFTForm";

export default function Home() {
  const { isConnected } = useAccount();
  const [tab, setTab] = useState<"market" | "list">("market");

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">NFT Marketplace</h1>
          <p className="text-gray-500 mt-1">Sepolia Testnet — Trade NFTs with MTK tokens</p>
        </div>
        <ConnectButton />
      </div>

      {!isConnected ? (
        <div className="text-center py-20">
          <p className="text-6xl mb-6">🔗</p>
          <h2 className="text-xl text-gray-600 mb-4">Connect your wallet to get started</h2>
          <p className="text-gray-400 mb-8 max-w-md mx-auto">
            Use WalletConnect to connect your wallet. You can list NFTs for sale
            and buy NFTs from other users using MTK tokens.
          </p>
          <div className="inline-flex justify-center">
            <ConnectButton />
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-4 mb-8 border-b border-gray-200">
            <button
              onClick={() => setTab("market")}
              className={`pb-3 px-2 text-lg font-medium transition border-b-2 ${
                tab === "market"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Marketplace
            </button>
            <button
              onClick={() => setTab("list")}
              className={`pb-3 px-2 text-lg font-medium transition border-b-2 ${
                tab === "list"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              List NFT
            </button>
          </div>

          {tab === "market" ? <MarketplaceGrid /> : <ListNFTForm />}
        </>
      )}
    </main>
  );
}
