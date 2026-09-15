"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { short } from "@/lib/format";

const INSTALL = [
  { name: "Phantom", url: "https://phantom.app/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/download" },
];

export default function WalletButton({ block = false }: { block?: boolean }) {
  const { wallets, select, connect, disconnect, connected, connecting, publicKey, wallet } = useWallet();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const detected = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  // select() then connect() once the adapter is actually selected.
  useEffect(() => {
    if (!pending || wallet?.adapter.name !== pending) return;
    connect()
      .then(() => setOpen(false))
      .catch((e) => setError(/reject|denied|cancel/i.test(String(e)) ? "Cancelled in the wallet." : "Could not connect. Unlock the wallet and try again."))
      .finally(() => setPending(null));
  }, [pending, wallet, connect]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (connected && publicKey) {
    return (
      <div style={{ position: "relative" }}>
        <button type="button" className={`btn ${block ? "btn-block btn-lg" : ""}`} onClick={() => setMenu((m) => !m)}>
          {wallet?.adapter.icon && <img src={wallet.adapter.icon} alt="" width={16} height={16} />}
          <span className="mono">{short(publicKey.toBase58())}</span>
        </button>
        {menu && (
          <div className="panel" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", padding: 6, minWidth: 180, zIndex: 40 }}>
            <button type="button" className="btn btn-ghost btn-block" style={{ justifyContent: "flex-start" }} onClick={() => { void disconnect(); setMenu(false); }}>
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <button type="button" className={`btn btn-primary ${block ? "btn-block btn-lg" : ""}`} onClick={() => { setError(null); setOpen(true); }}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
      {open && (
        <div className="backdrop" onClick={() => setOpen(false)}>
          <div className="panel dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-h" onClick={(e) => e.stopPropagation()}>
            <div className="spread">
              <h3 id="wallet-h" style={{ margin: 0, fontSize: 17 }}>Connect a Solana wallet</h3>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>
            <ul className="wlist">
              {detected.map((w) => (
                <li key={w.adapter.name}>
                  <button type="button" className="wrow" onClick={() => { setError(null); setPending(w.adapter.name); select(w.adapter.name); }}>
                    <span>{w.adapter.name} <span className="chip chip-ok" style={{ marginLeft: 6 }}>Detected</span></span>
                    <img src={w.adapter.icon} alt="" width={24} height={24} />
                  </button>
                </li>
              ))}
              {INSTALL.filter((k) => !detected.some((w) => w.adapter.name === k.name)).map((k) => (
                <li key={k.name}>
                  <a className="wrow" href={k.url} target="_blank" rel="noreferrer">
                    <span>{k.name} <span className="chip" style={{ marginLeft: 6 }}>Install</span></span>
                  </a>
                </li>
              ))}
            </ul>
            {error && <div className="note note-bad">{error}</div>}
            <p className="tiny muted" style={{ margin: 0 }}>You sign every transaction in your wallet. Stockcurve never holds keys or funds.</p>
          </div>
        </div>
      )}
    </>
  );
}
