"use client";

import { useState, useEffect, useRef } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { formatEther } from "viem";
import { CONTRACTS } from "../contracts/addresses";
import NFTMarketABI from "../contracts/abis/NFTMarket.json";
import MyTokenABI from "../contracts/abis/MyToken.json";
import { useNFTMetadata } from "../hooks/useNFTMetadata";
import { useToast } from "../context/ToastContext";

interface ListingInfo {
  seller: string;
  price: bigint;
  active: boolean;
}

interface NFTCardProps {
  tokenId: bigint;
  listing: ListingInfo;
  loading?: boolean;
  onRefresh: () => void;
}

export default function NFTCard({ tokenId, listing, loading: listingLoading, onRefresh }: NFTCardProps) {
  const { address } = useAccount();
  const { addToast, updateToast } = useToast();
  const { metadata, imageUrl, loading: metadataLoading } = useNFTMetadata(tokenId);

  const [step, setStep] = useState<"idle" | "approving" | "buying">("idle");
  const [buyMethod, setBuyMethod] = useState<"approve" | "callback">("approve");

  // Track toast IDs so we can update them when tx settles
  const approveToastId = useRef("");
  const buyToastId = useRef("");

  const isSeller = address && listing.seller.toLowerCase() === address.toLowerCase();
  const isActive = listing.active;
  const priceMTK = listing.price > 0n ? formatEther(listing.price) : "0";
  const isLoading = listingLoading || metadataLoading;

  // Token allowance check
  const { data: allowance } = useReadContract({
    address: CONTRACTS.MyToken,
    abi: MyTokenABI,
    functionName: "allowance",
    args: address ? [address, CONTRACTS.NFTMarket] : undefined,
    query: { enabled: !!address && !isSeller },
  });

  const hasAllowance = allowance && listing.price > 0n && (allowance as bigint) >= listing.price;

  // Approve Token
  const { writeContract: approveToken, data: approveHash } = useWriteContract();
  const { isLoading: isApprovePending, isSuccess: isApproveConfirmed, isError: isApproveFailed } =
    useWaitForTransactionReceipt({ hash: approveHash });

  // Buy via approve+buyNFT
  const { writeContract: buyNFT, data: buyHash } = useWriteContract();
  const { isLoading: isBuyPending, isSuccess: isBuyConfirmed, isError: isBuyFailed } =
    useWaitForTransactionReceipt({ hash: buyHash });

  // One-click buy via transfer+callback
  const { writeContract: buyCallback, data: buyCallbackHash } = useWriteContract();
  const { isLoading: isCallbackPending, isSuccess: isCallbackConfirmed, isError: isCallbackFailed } =
    useWaitForTransactionReceipt({ hash: buyCallbackHash });

  // Unlist
  const { writeContract: unlistNFT, data: unlistHash } = useWriteContract();
  const { isLoading: isUnlistPending, isSuccess: isUnlistConfirmed, isError: isUnlistFailed } =
    useWaitForTransactionReceipt({ hash: unlistHash });

  // After approve confirmed, auto-buy
  useEffect(() => {
    if (isApproveConfirmed && step === "approving") {
      setStep("buying");
      if (approveToastId.current) {
        updateToast(approveToastId.current, { type: "success", title: "Token approved — buying NFT..." });
      }
      buyNFT({
        address: CONTRACTS.NFTMarket,
        abi: NFTMarketABI,
        functionName: "buyNFT",
        args: [tokenId, listing.price],
      });
    }
  }, [isApproveConfirmed]);

  // Handle buy completion
  useEffect(() => {
    if (isBuyConfirmed || isCallbackConfirmed) {
      setStep("idle");
      if (buyToastId.current) {
        updateToast(buyToastId.current, {
          type: "success",
          title: `NFT #${tokenId.toString()} purchased!`,
          txHash: buyHash || buyCallbackHash,
        });
      }
      buyToastId.current = "";
      approveToastId.current = "";
      onRefresh();
    }
  }, [isBuyConfirmed, isCallbackConfirmed]);

  // Handle buy failure
  useEffect(() => {
    if (isBuyFailed || isCallbackFailed) {
      setStep("idle");
      if (buyToastId.current) {
        updateToast(buyToastId.current, {
          type: "error",
          title: "Purchase failed",
          message: "Transaction reverted. Check your balance and try again.",
        });
      }
      buyToastId.current = "";
      approveToastId.current = "";
    }
  }, [isBuyFailed, isCallbackFailed]);

  // Handle approve failure
  useEffect(() => {
    if (isApproveFailed && step === "approving") {
      setStep("idle");
      if (approveToastId.current) {
        updateToast(approveToastId.current, {
          type: "error",
          title: "Approval failed",
          message: "Token approval was rejected or reverted.",
        });
      }
      approveToastId.current = "";
    }
  }, [isApproveFailed]);

  // Handle unlist
  useEffect(() => {
    if (isUnlistConfirmed) {
      addToast({ type: "success", title: `NFT #${tokenId.toString()} delisted`, txHash: unlistHash });
      onRefresh();
    }
  }, [isUnlistConfirmed]);

  useEffect(() => {
    if (isUnlistFailed) {
      addToast({ type: "error", title: "Delist failed", message: "Transaction reverted." });
    }
  }, [isUnlistFailed]);

  const handleBuyApprove = () => {
    if (!hasAllowance) {
      setStep("approving");
      approveToastId.current = addToast({ type: "pending", title: "Approving token spend..." });
      approveToken({
        address: CONTRACTS.MyToken,
        abi: MyTokenABI,
        functionName: "approve",
        args: [CONTRACTS.NFTMarket, listing.price],
      });
      return;
    }
    // Already approved, go straight to buy
    setStep("buying");
    buyToastId.current = addToast({ type: "pending", title: `Buying NFT #${tokenId.toString()}...` });
    buyNFT({
      address: CONTRACTS.NFTMarket,
      abi: NFTMarketABI,
      functionName: "buyNFT",
      args: [tokenId, listing.price],
    });
  };

  const handleBuyCallback = () => {
    buyToastId.current = addToast({ type: "pending", title: `Buying NFT #${tokenId.toString()} (1-tx)...` });
    buyCallback({
      address: CONTRACTS.MyToken,
      abi: MyTokenABI,
      functionName: "transfer",
      args: [CONTRACTS.NFTMarket, listing.price, encodeTokenId(tokenId)],
    });
  };

  const handleUnlist = () => {
    addToast({ type: "pending", title: `Delisting NFT #${tokenId.toString()}...` });
    unlistNFT({
      address: CONTRACTS.NFTMarket,
      abi: NFTMarketABI,
      functionName: "unlist",
      args: [tokenId],
    });
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-md overflow-hidden animate-pulse">
        <div className="aspect-square bg-gray-100 flex items-center justify-center">
          <span className="text-4xl opacity-30">🖼️</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="h-5 bg-gray-200 rounded w-3/4" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
          <div className="h-10 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-white rounded-xl shadow-md overflow-hidden border-2 transition hover:shadow-lg ${
        isActive ? "border-green-200 hover:border-green-400" : "border-gray-100"
      }`}
    >
      {/* NFT Image */}
      <div className="aspect-square bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center relative overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={metadata?.name || `NFT #${tokenId}`}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
            }}
          />
        ) : null}
        <span className={`text-6xl ${imageUrl ? "hidden" : ""}`}>🖼️</span>

        {/* Status badge */}
        {isActive ? (
          <span className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full font-medium">
            Listed
          </span>
        ) : listing.seller !== "0x0000000000000000000000000000000000000000" ? (
          <span className="absolute top-2 right-2 bg-gray-400 text-white text-xs px-2 py-1 rounded-full font-medium">
            Sold / Delisted
          </span>
        ) : null}
      </div>

      <div className="p-4">
        <h3 className="text-lg font-bold text-gray-900 truncate">
          {metadata?.name || `NFT #${tokenId.toString()}`}
        </h3>
        {metadata?.description && (
          <p className="text-xs text-gray-400 mt-1 line-clamp-1">{metadata.description}</p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          Token ID: #{tokenId.toString()}
        </p>

        {isActive ? (
          <>
            <div className="mt-3 bg-green-50 rounded-lg p-3">
              <p className="text-xs text-green-600">Price</p>
              <p className="text-xl font-bold text-green-800">{priceMTK} MTK</p>
              <p className="text-xs text-green-600 mt-1">
                Seller: {listing.seller.slice(0, 6)}...{listing.seller.slice(-4)}
              </p>
            </div>

            {isSeller ? (
              <button
                onClick={handleUnlist}
                disabled={isUnlistPending}
                className="mt-3 w-full bg-orange-500 text-white py-2.5 rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50 transition"
              >
                {isUnlistPending ? "Delisting..." : "Delist"}
              </button>
            ) : (
              <div className="mt-3 space-y-2">
                {/* Method selector */}
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={() => setBuyMethod("approve")}
                    className={`flex-1 py-1.5 rounded border font-medium transition ${
                      buyMethod === "approve"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    Approve + Buy (2 tx)
                  </button>
                  <button
                    onClick={() => setBuyMethod("callback")}
                    className={`flex-1 py-1.5 rounded border font-medium transition ${
                      buyMethod === "callback"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    One-Click Buy (1 tx)
                  </button>
                </div>

                {buyMethod === "approve" ? (
                  step === "idle" ? (
                    <button
                      onClick={handleBuyApprove}
                      disabled={isApprovePending || isBuyPending}
                      className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                      {hasAllowance ? "Buy Now" : "Approve & Buy"}
                    </button>
                  ) : step === "approving" ? (
                    <button
                      disabled
                      className="w-full bg-blue-400 text-white py-2.5 rounded-lg font-medium transition"
                    >
                      Approving token...
                    </button>
                  ) : (
                    <button
                      disabled
                      className="w-full bg-green-400 text-white py-2.5 rounded-lg font-medium transition"
                    >
                      Buying NFT...
                    </button>
                  )
                ) : (
                  <button
                    onClick={handleBuyCallback}
                    disabled={isCallbackPending}
                    className="w-full bg-purple-600 text-white py-2.5 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 transition"
                  >
                    {isCallbackPending ? "Buying..." : `Buy (${priceMTK} MTK)`}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="mt-3 bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-gray-400 text-sm">
              {listing.seller !== "0x0000000000000000000000000000000000000000"
                ? "Sold or delisted"
                : "Not listed yet"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function encodeTokenId(tokenId: bigint): `0x${string}` {
  const hex = tokenId.toString(16).padStart(64, "0");
  return `0x${hex}`;
}
