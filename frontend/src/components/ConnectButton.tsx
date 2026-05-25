"use client";

import { useAccount } from "wagmi";

export default function ConnectButton() {
  const { address, isConnected } = useAccount();

  if (!isConnected) {
    return <appkit-button />;
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm bg-green-100 text-green-800 px-3 py-1.5 rounded-full font-mono">
        {address?.slice(0, 6)}...{address?.slice(-4)}
      </span>
      <appkit-button />
    </div>
  );
}
