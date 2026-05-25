"use client";

import { useReadContract } from "wagmi";
import { CONTRACTS } from "../contracts/addresses";
import MyNFTABI from "../contracts/abis/MyNFT.json";
import NFTMarketABI from "../contracts/abis/NFTMarket.json";
import MyTokenABI from "../contracts/abis/MyToken.json";
import NFTCard from "./NFTCard";
import { useCallback, useState } from "react";

interface ListingInfo {
  seller: string;
  price: bigint;
  active: boolean;
}

export default function MarketplaceGrid() {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: nextTokenId, isLoading: loadingCount } = useReadContract({
    address: CONTRACTS.MyNFT,
    abi: MyNFTABI,
    functionName: "nextTokenId",
    args: [],
  });

  const totalTokens = nextTokenId ? Number(nextTokenId) : 0;

  const onRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  if (loadingCount) {
    return (
      <div className="text-center py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-48 mx-auto" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl shadow-md overflow-hidden">
                <div className="aspect-square bg-gray-100" />
                <div className="p-4 space-y-3">
                  <div className="h-5 bg-gray-200 rounded w-3/4" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (totalTokens === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-4xl mb-4">🖼️</p>
        <p className="text-gray-500 text-lg">No NFTs minted yet.</p>
        <p className="text-gray-400 text-sm mt-2">
          Use the &ldquo;List NFT&rdquo; tab or the CLI to mint and list NFTs.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-800">
          Marketplace ({totalTokens} NFTs)
        </h2>
        <button
          onClick={onRefresh}
          className="text-sm text-blue-600 hover:text-blue-800 transition font-medium"
        >
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {Array.from({ length: totalTokens }, (_, i) => (
          <NFTListingItem
            key={`${i}-${refreshKey}`}
            tokenId={BigInt(i)}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}

function NFTListingItem({ tokenId, onRefresh }: { tokenId: bigint; onRefresh: () => void }) {
  const { data: listing, isLoading: listingLoading } = useReadContract({
    address: CONTRACTS.NFTMarket,
    abi: NFTMarketABI,
    functionName: "listings",
    args: [tokenId],
  });

  const listingInfo: ListingInfo = listing
    ? {
        seller: (listing as [string, bigint, boolean])[0],
        price: (listing as [string, bigint, boolean])[1],
        active: (listing as [string, bigint, boolean])[2],
      }
    : {
        seller: "0x0000000000000000000000000000000000000000",
        price: 0n,
        active: false,
      };

  return (
    <NFTCard
      tokenId={tokenId}
      listing={listingInfo}
      loading={listingLoading}
      onRefresh={onRefresh}
    />
  );
}
