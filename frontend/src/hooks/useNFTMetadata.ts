"use client";

import { useReadContract } from "wagmi";
import { useEffect, useState } from "react";
import { CONTRACTS } from "../contracts/addresses";
import MyNFTABI from "../contracts/abis/MyNFT.json";

interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  attributes?: { trait_type: string; value: string }[];
}

const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
];

function ipfsToHttp(uri: string): string {
  if (uri.startsWith("ipfs://")) {
    const cid = uri.replace("ipfs://", "");
    return `${IPFS_GATEWAYS[0]}${cid}`;
  }
  return uri;
}

const metadataCache: Record<string, NFTMetadata | null> = {};

export function useNFTMetadata(tokenId: bigint | number | undefined) {
  const [metadata, setMetadata] = useState<NFTMetadata | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: tokenURI } = useReadContract({
    address: CONTRACTS.MyNFT,
    abi: MyNFTABI,
    functionName: "tokenURI",
    args: tokenId !== undefined ? [BigInt(tokenId.toString())] : undefined,
    query: { enabled: tokenId !== undefined },
  }) as { data: string | undefined };

  useEffect(() => {
    if (!tokenURI) return;

    const cacheKey = tokenURI;
    if (metadataCache[cacheKey] !== undefined) {
      setMetadata(metadataCache[cacheKey]);
      return;
    }

    let cancelled = false;

    async function fetchMetadata() {
      setLoading(true);
      try {
        // Try each gateway
        let data: NFTMetadata | null = null;
        for (const gateway of IPFS_GATEWAYS) {
          try {
            const url = tokenURI!.startsWith("ipfs://")
              ? `${gateway}${tokenURI!.replace("ipfs://", "")}`
              : tokenURI!;
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
              data = await res.json();
              break;
            }
          } catch {
            continue;
          }
        }

        if (!cancelled) {
          metadataCache[cacheKey] = data;
          setMetadata(data);
        }
      } catch {
        if (!cancelled) {
          metadataCache[cacheKey] = null;
          setMetadata(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMetadata();
    return () => { cancelled = true; };
  }, [tokenURI]);

  return { metadata, loading, imageUrl: metadata?.image ? ipfsToHttp(metadata.image) : undefined };
}
