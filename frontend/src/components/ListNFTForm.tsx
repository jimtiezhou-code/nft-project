"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { formatEther, parseEther } from "viem";
import { CONTRACTS } from "../contracts/addresses";
import MyNFTABI from "../contracts/abis/MyNFT.json";
import NFTMarketABI from "../contracts/abis/NFTMarket.json";
import MyTokenABI from "../contracts/abis/MyToken.json";
import { useNFTMetadata } from "../hooks/useNFTMetadata";
import { useToast } from "../context/ToastContext";

export default function ListNFTForm() {
  const { address } = useAccount();
  const { addToast } = useToast();

  const [selectedTokenId, setSelectedTokenId] = useState<string>("");
  const [priceMTK, setPriceMTK] = useState<string>("");
  const [step, setStep] = useState<"idle" | "approving" | "listing">("idle");

  // MTK balance
  const { data: mtkBalance, refetch: refetchBalance } = useReadContract({
    address: CONTRACTS.MyToken,
    abi: MyTokenABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Total NFTs
  const { data: nextTokenId, refetch: refetchNextId } = useReadContract({
    address: CONTRACTS.MyNFT,
    abi: MyNFTABI,
    functionName: "nextTokenId",
    args: [],
  });

  // Ownership check
  const { data: tokenOwner } = useReadContract({
    address: CONTRACTS.MyNFT,
    abi: MyNFTABI,
    functionName: "ownerOf",
    args: selectedTokenId ? [BigInt(selectedTokenId)] : undefined,
    query: { enabled: !!selectedTokenId },
  });

  const isOwner = address && tokenOwner
    ? (tokenOwner as string).toLowerCase() === address.toLowerCase()
    : false;

  // NFT metadata preview
  const { metadata, imageUrl } = useNFTMetadata(
    selectedTokenId ? BigInt(selectedTokenId) : undefined
  );

  // Approve NFT
  const { writeContract: approveNFT, data: approveHash } = useWriteContract();
  const { isLoading: isApprovePending, isSuccess: isApproveConfirmed, isError: isApproveFailed } =
    useWaitForTransactionReceipt({ hash: approveHash });

  // List NFT
  const { writeContract: listNFT, data: listHash } = useWriteContract();
  const { isLoading: isListPending, isSuccess: isListConfirmed, isError: isListFailed } =
    useWaitForTransactionReceipt({ hash: listHash });

  // Chain: approve → list
  useEffect(() => {
    if (isApproveConfirmed && step === "approving") {
      setStep("listing");
      addToast({ type: "pending", title: "Approval confirmed — listing NFT...", txHash: approveHash });
      listNFT({
        address: CONTRACTS.NFTMarket,
        abi: NFTMarketABI,
        functionName: "list",
        args: [BigInt(selectedTokenId), parseEther(priceMTK)],
      });
    }
  }, [isApproveConfirmed]);

  // List confirmed
  useEffect(() => {
    if (isListConfirmed) {
      setStep("idle");
      addToast({
        type: "success",
        title: `NFT #${selectedTokenId} listed!`,
        message: `Price: ${priceMTK} MTK`,
        txHash: listHash,
      });
      setSelectedTokenId("");
      setPriceMTK("");
      refetchBalance();
      refetchNextId();
    }
  }, [isListConfirmed]);

  // List failed
  useEffect(() => {
    if (isListFailed) {
      setStep("idle");
      addToast({ type: "error", title: "Listing failed", message: "Transaction reverted." });
    }
  }, [isListFailed]);

  // Approve failed
  useEffect(() => {
    if (isApproveFailed && step === "approving") {
      setStep("idle");
      addToast({ type: "error", title: "Approval failed", message: "Please try again." });
    }
  }, [isApproveFailed]);

  const handleList = () => {
    if (!selectedTokenId || !priceMTK) {
      addToast({ type: "error", title: "Please select an NFT and enter a price." });
      return;
    }
    if (!isOwner) {
      addToast({ type: "error", title: "You do not own this NFT." });
      return;
    }

    setStep("approving");
    addToast({ type: "pending", title: "Approving NFT transfer..." });

    approveNFT({
      address: CONTRACTS.MyNFT,
      abi: MyNFTABI,
      functionName: "approve",
      args: [CONTRACTS.NFTMarket, BigInt(selectedTokenId)],
    });
  };

  const totalTokens = nextTokenId ? Number(nextTokenId) : 0;
  const balanceNum = mtkBalance !== undefined ? Number(formatEther(mtkBalance as bigint)) : 0;

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">List Your NFT</h2>

        {/* MTK Balance */}
        <div className="mb-6 p-4 bg-blue-50 rounded-lg">
          <p className="text-sm text-blue-600">Your MTK Balance</p>
          <p className="text-2xl font-bold text-blue-800">
            {balanceNum.toFixed(2)} MTK
          </p>
        </div>

        {/* Select Token */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select NFT Token ID
          </label>
          {totalTokens > 0 ? (
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: totalTokens }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedTokenId(String(i))}
                  className={`py-2 rounded border text-sm font-medium transition ${
                    selectedTokenId === String(i)
                      ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200"
                      : "border-gray-200 text-gray-600 hover:border-gray-300"
                  }`}
                >
                  #{i}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No NFTs available to list.</p>
          )}

          {selectedTokenId && (
            <div className="mt-3 p-3 rounded-lg border border-gray-200">
              {isOwner ? (
                <span className="text-green-600 text-sm font-medium">You own NFT #{selectedTokenId}</span>
              ) : (
                <span className="text-red-600 text-sm font-medium">You don&rsquo;t own NFT #{selectedTokenId}</span>
              )}
            </div>
          )}
        </div>

        {/* NFT Preview */}
        {selectedTokenId && metadata && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg flex gap-3 items-center">
            <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-200 flex-shrink-0">
              {imageUrl ? (
                <img src={imageUrl} alt={metadata.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl">🖼️</div>
              )}
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">{metadata.name}</p>
              <p className="text-xs text-gray-400 line-clamp-1">{metadata.description}</p>
            </div>
          </div>
        )}

        {/* Price */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Price (MTK)
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={priceMTK}
            onChange={(e) => setPriceMTK(e.target.value)}
            placeholder="e.g. 100"
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>

        {/* List button */}
        <button
          onClick={handleList}
          disabled={!selectedTokenId || !priceMTK || !isOwner || step !== "idle" || isApprovePending || isListPending}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {step === "approving"
            ? "Approving NFT... (confirm in wallet)"
            : step === "listing"
            ? "Listing... (confirm in wallet)"
            : "List NFT"}
        </button>

        <p className="mt-3 text-xs text-gray-400 text-center">
          This will execute 2 transactions: 1. Approve NFT → 2. List on marketplace.
          Confirm both in your wallet.
        </p>
      </div>
    </div>
  );
}
