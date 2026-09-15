"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";

export default function Providers({ children }: { children: React.ReactNode }) {
  // The browser talks to /api/rpc, which holds the RPC key server-side.
  const endpoint = useMemo(
    () => (typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : "https://api.mainnet-beta.solana.com"),
    [],
  );
  // Empty adapter list: Phantom, Solflare, Backpack register via Wallet Standard.
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
