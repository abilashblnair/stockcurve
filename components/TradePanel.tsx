"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { TradeQuote } from "@/lib/server/trade";
import { amount as fmt, bps, pct, solscan } from "@/lib/format";
import { friendlyError, signSendConfirm } from "@/lib/client/send";
import WalletButton from "./WalletButton";

type Side = "buy" | "sell";
type Asset = "SOL" | "USDC" | "STOCK";
type Balances = { sol: number; usdc: number; stock: number; token: number };

const PRESETS: Record<Asset, string[]> = { SOL: ["0.01", "0.05", "0.1"], USDC: ["1", "5", "20"], STOCK: ["0.005", "0.01", "0.05"] };
const SLIPPAGES = [100, 300, 1000];

export default function TradePanel({
  pool,
  tokenSymbol,
  stockSymbol,
  feeNowBps,
  isMigrated,
  onTraded,
}: {
  pool: string;
  tokenSymbol: string;
  stockSymbol: string;
  feeNowBps: number;
  isMigrated: boolean;
  onTraded: () => void;
}) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const [side, setSide] = useState<Side>("buy");
  const [asset, setAsset] = useState<Asset>("SOL");
  const [amount, setAmount] = useState("0.01");
  const [slippage, setSlippage] = useState(300);
  const [direct, setDirect] = useState(false);
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [bal, setBal] = useState<Balances | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);

  const assetLabel = (a: Asset) => (a === "STOCK" ? stockSymbol : a);
  const inputBalance = bal ? (side === "sell" ? bal.token : asset === "SOL" ? bal.sol : asset === "USDC" ? bal.usdc : bal.stock) : null;

  const loadBalances = useCallback(() => {
    if (!publicKey) return setBal(null);
    fetch(`/api/balances?wallet=${publicKey.toBase58()}&pool=${pool}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => !j.error && setBal(j))
      .catch(() => {});
  }, [publicKey, pool]);
  useEffect(() => loadBalances(), [loadBalances]);

  // Reset amount to something sensible when the side or asset changes.
  useEffect(() => {
    setDone(null);
    setError(null);
    if (side === "buy") setAmount(PRESETS[asset][0]);
    else setAmount("");
    if (asset !== "STOCK") setDirect(false);
  }, [side, asset]);

  // Debounced quote.
  useEffect(() => {
    const id = ++seq.current;
    setQuote(null);
    setQuoteError(null);
    if (!(Number(amount) > 0)) return;
    setQuoting(true);
    const t = setTimeout(() => {
      fetch("/api/trade/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pool, side, asset, amount, slippageBps: slippage, route: direct ? "dbc" : "auto" }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (id !== seq.current) return;
          if (j.error) setQuoteError(j.error);
          else setQuote(j);
        })
        .catch(() => id === seq.current && setQuoteError("Could not get a quote."))
        .finally(() => id === seq.current && setQuoting(false));
    }, 400);
    return () => clearTimeout(t);
  }, [pool, side, asset, amount, slippage, direct]);

  async function submit() {
    if (!publicKey || !signTransaction) return;
    setError(null);
    setDone(null);
    try {
      setBusy("Building and simulating…");
      const b = await fetch("/api/trade/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pool, side, asset, amount, slippageBps: slippage, route: direct ? "dbc" : "auto", wallet: publicKey.toBase58() }),
      }).then((r) => r.json());
      if (b.error) throw new Error(b.error);
      if (!b.simulation.ok) throw new Error(b.simulation.error ?? "Simulation failed.");
      setBusy("Confirm in your wallet…");
      const sig = await signSendConfirm(connection, signTransaction, b.tx, b.lastValidBlockHeight);
      setBusy(null);
      setDone(sig);
      loadBalances();
      onTraded();
      setTimeout(loadBalances, 2500);
    } catch (e) {
      setBusy(null);
      setError(friendlyError(e));
    }
  }

  const outSymbol = side === "buy" ? tokenSymbol : assetLabel(asset);
  const insufficient = inputBalance !== null && Number(amount) > inputBalance + 1e-12;

  return (
    <div className="panel panel-pad stack-sm">
      <div className="spread">
        <div className="seg" role="group" aria-label="Trade side">
          <button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button>
          <button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
        </div>
        <div className="hstack tiny muted" style={{ gap: 4 }}>
          Slippage
          {SLIPPAGES.map((s) => (
            <button key={s} type="button" className={`chip ${slippage === s ? "chip-ok" : ""}`} style={{ border: 0, cursor: "pointer" }} onClick={() => setSlippage(s)}>{bps(s)}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label">{side === "buy" ? "Pay with" : "Receive"}</span>
        <div className="seg" role="group" aria-label={side === "buy" ? "Pay with" : "Receive"}>
          {(["SOL", "USDC", "STOCK"] as Asset[]).map((a) => (
            <button key={a} type="button" aria-pressed={asset === a} onClick={() => setAsset(a)}>{assetLabel(a)}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="spread">
          <label htmlFor="trade-amt" className="label">{side === "buy" ? `Amount of ${assetLabel(asset)}` : `Amount of ${tokenSymbol}`}</label>
          {inputBalance !== null && (
            <button type="button" className="btn btn-ghost tiny" style={{ height: 22, padding: "0 6px" }} onClick={() => setAmount(side === "buy" && asset === "SOL" ? String(Math.max(0, inputBalance - 0.01).toFixed(4)) : String(inputBalance))}>
              Balance {fmt(inputBalance, 6)}
            </button>
          )}
        </div>
        <input id="trade-amt" className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" />
        <div className="hstack" style={{ gap: 6 }}>
          {side === "buy"
            ? PRESETS[asset].map((p) => <button key={p} type="button" className="chip" style={{ border: 0, cursor: "pointer" }} onClick={() => setAmount(p)}>{p}</button>)
            : [25, 50, 100].map((p) => (
                <button key={p} type="button" className="chip" style={{ border: 0, cursor: "pointer" }} disabled={!bal?.token} onClick={() => bal && setAmount(String(p === 100 ? bal.token : Math.floor(bal.token * p) / 100))}>{p}%</button>
              ))}
        </div>
      </div>

      <div className="note" style={{ minHeight: 64 }}>
        {quoting && !quote ? (
          <span className="muted">Getting a quote…</span>
        ) : quote ? (
          <div className="stack-sm" style={{ gap: 4 }}>
            <div className="spread"><span>You receive about</span><strong className="mono">{fmt(quote.outAmount, 6)} {outSymbol}</strong></div>
            <div className="spread tiny muted"><span>Minimum after slippage</span><span className="mono">{fmt(quote.minOut, 6)}</span></div>
            {quote.priceImpactPct !== null && <div className="spread tiny muted"><span>Price impact</span><span className="mono">{pct(quote.priceImpactPct, 2)}</span></div>}
            <div className="tiny muted">{quote.routeLabel}</div>
          </div>
        ) : quoteError ? (
          <span className="small">{quoteError}</span>
        ) : (
          <span className="muted small">Enter an amount.</span>
        )}
      </div>

      {!isMigrated && feeNowBps >= 500 && (
        <div className="note note-warn tiny">The opening fee is {bps(feeNowBps)} right now and is already included in the quote. It falls over the opening window.</div>
      )}
      {asset === "STOCK" && !isMigrated && (
        <label className="toggle tiny">
          <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
          <span>Swap directly on the curve (skip Jupiter; for pools Jupiter has not indexed yet)</span>
        </label>
      )}

      {!connected ? (
        <WalletButton block />
      ) : (
        <button type="button" className={`btn btn-lg btn-block ${side === "buy" ? "btn-accent" : "btn-primary"}`} disabled={!quote || !!busy || insufficient} onClick={submit}>
          {busy ?? (insufficient ? `Not enough ${side === "sell" ? tokenSymbol : assetLabel(asset)}` : `${side === "buy" ? "Buy" : "Sell"} ${tokenSymbol}`)}
        </button>
      )}
      {error && <div className="note note-bad small">{error}</div>}
      {done && (
        <div className="note note-ok small">
          Done. <a href={solscan("tx", done)} target="_blank" rel="noreferrer">View transaction</a>
        </div>
      )}
      <p className="tiny muted" style={{ margin: 0 }}>Every trade is simulated before your wallet opens. SOL and USDC route through {stockSymbol} via Jupiter.</p>
    </div>
  );
}
