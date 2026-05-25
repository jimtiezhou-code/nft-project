"use client";

import { useEffect } from "react";
import { useToast, type Toast } from "../context/ToastContext";

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    if (toast.type !== "pending") {
      const timer = setTimeout(onDismiss, 8000);
      return () => clearTimeout(timer);
    }
  }, [toast.type, onDismiss]);

  const bgColor = {
    info: "bg-blue-50 border-blue-200 text-blue-800",
    success: "bg-green-50 border-green-200 text-green-800",
    error: "bg-red-50 border-red-200 text-red-800",
    pending: "bg-yellow-50 border-yellow-200 text-yellow-800",
  }[toast.type];

  const icon = {
    info: "i",
    success: "OK",
    error: "X",
    pending: "...",
  }[toast.type];

  return (
    <div className={`border rounded-lg p-4 shadow-lg ${bgColor} animate-slide-in min-w-[320px] max-w-[420px]`}>
      <div className="flex items-start gap-3">
        <span className="font-bold text-sm mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{toast.title}</p>
          {toast.message && <p className="text-xs mt-1 opacity-75">{toast.message}</p>}
          {toast.txHash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${toast.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline mt-1 inline-block opacity-75 hover:opacity-100"
            >
              View on Etherscan
            </a>
          )}
        </div>
        <button onClick={onDismiss} className="text-sm opacity-50 hover:opacity-100 ml-2">
          x
        </button>
      </div>
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}
