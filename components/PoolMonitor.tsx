"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { PoolSnapshot, Trade } from "@/lib/server/pool";
import { ago, amount, bps, duration, pct, short, solscan, tiny, usd } from "@/lib/format";
import { friendlyError, signSendConfirm } from "@/lib/client/send";
import { CurveChart, FeeChart } from "./Charts";
import PoolChart from "./PoolChart";
import TradePanel from "./TradePanel";

const SNAPSHOT_MS = 10_000;
const TRADES_MS = 15_000;

function Avatar({ src, label, lg }: { src: string | null; label: string; lg?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`avatar ${lg ? "avatar-lg" : ""}`}>
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : label.slice(0, 2).toUpperCase()}
    </span>
  );
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn btn-ghost mono small" style={{ height: 28, padding: "0 8px" }} onClick={() => { void navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); }} title={value}>
      {done ? "copied" : short(value, 5)}
    </button>
  );
}

function ClaimButton({ pool, amountLabel, onClaimed }: { pool: string; amountLabel: string; onClaimed: () => void }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  async function claim() {
    if (!publicKey || !signTransaction) return;
    setMsg(null);
    try {
      setBusy("Simulating…");
      const b = await fetch("/api/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pool, wallet: publicKey.toBase58() }) }).then((r) => r.json());
      if (b.error) throw new Error(b.error);
      if (!b.simulation.ok) throw new Error(b.simulation.error ?? "Simulation failed.");
      setBusy("Confirm in your wallet…");
      const sig = await signSendConfirm(connection, signTransaction, b.tx, b.lastValidBlockHeight);
      setMsg({ ok: true, text: "Fees claimed to your wallet.", sig });
      onClaimed();
    } catch (e) {
      setMsg({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="stack-sm">
      <button type="button" className="btn btn-accent btn-block" onClick={claim} disabled={!!busy}>{busy ?? `Claim ${amountLabel}`}</button>
      {msg && (
        <div className={`note small ${msg.ok ? "note-ok" : "note-bad"}`}>
          {msg.text} {msg.sig && <a href={solscan("tx", msg.sig)} target="_blank" rel="noreferrer">View transaction</a>}
        </div>
      )}
    </div>
  );
}

export default function PoolMonitor({ address, launched }: { address: string; launched?: string }) {
  const { publicKey } = useWallet();
  const [snap, setSnap] = useState<PoolSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [pendingTx, setPendingTx] = useState(0);
  const [chartTab, setChartTab] = useState<"price" | "curve">("price");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/pool/${address}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        // A pool created seconds ago may not be readable yet; keep trying quietly.
        if (!(launched && r.status === 404)) setError(j.error ?? "Could not load this pool.");
        return;
      }
      setSnap(j);
      setError(null);
      setUpdated(Date.now());
    } catch {
      setError("Network error, retrying.");
    }
  }, [address, launched]);

  const loadTrades = useCallback(async () => {
    try {
      const j = await fetch(`/api/pool/${address}/trades`, { cache: "no-store" }).then((r) => r.json());
      if (j.trades) {
        setTrades(j.trades);
        setPendingTx(j.pending ?? 0);
        // The RPC was slow to return some transactions: look again soon instead of waiting a full cycle.
        if (j.pending) setTimeout(() => void fetch(`/api/pool/${address}/trades`, { cache: "no-store" }).then((r) => r.json()).then((k) => k.trades && (setTrades(k.trades), setPendingTx(k.pending ?? 0))).catch(() => {}), 5000);
      }
    } catch {
      /* keep the last list */
    }
  }, [address]);

  const refreshAll = useCallback(() => {
    void load();
    setTimeout(() => void loadTrades(), 1500);
  }, [load, loadTrades]);

  useEffect(() => {
    void load();
    const a = setInterval(() => document.visibilityState === "visible" && void load(), SNAPSHOT_MS);
    return () => clearInterval(a);
  }, [load]);

  useEffect(() => {
    if (!snap) return;
    void loadTrades();
    const b = setInterval(() => document.visibilityState === "visible" && void loadTrades(), TRADES_MS);
    return () => clearInterval(b);
    // Start trades once the pool is known to exist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!snap, loadTrades]);

  if (!snap) {
    return (
      <div className="stack">
        {launched && !error && <div className="note note-ok">Pool created. Waiting for the network to show it… this usually takes a few seconds.</div>}
        {error ? <div className="note note-bad">{error}</div> : <div className="skeleton" style={{ height: 76 }} />}
        {!error && <div className="skeleton" style={{ height: 360 }} />}
      </div>
    );
  }

  const s = snap;
  const u = s.stock.usd; // stock amounts in the snapshot are display amounts
  const curveUsd = u !== null ? u * s.stock.multiplier : null; // curve points are raw stock units
  const inWindow = s.fees.durationSec > 0 && s.feeElapsedSec < s.fees.durationSec;
  const status = s.isMigrated ? { label: "Graduated to DAMM v2", cls: "chip-ok" } : s.curveComplete ? { label: "Curve complete, migrating", cls: "chip-warn" } : { label: "Bonding", cls: "" };
  const me = publicKey?.toBase58();
  const isPartner = me === s.feeClaimer;
  const isCreator = me === s.creator;
  const mine = isPartner || isCreator;
  const claimable = (isPartner ? s.unclaimed.partner : 0) + (isCreator ? s.unclaimed.creator : 0);
  const reservePerSold = s.sold > 0 ? s.quoteReserve / s.sold : null;
  const shareText = encodeURIComponent(`${s.token.name} ($${s.token.symbol}) is live on a bonding curve priced in ${s.stock.symbol}.`);
  const pageUrl = typeof window !== "undefined" ? encodeURIComponent(window.location.origin + `/pool/${s.address}`) : "";

  return (
    <div className="stack" style={{ gap: 20 }}>
      {launched && (
        <div className="note note-ok spread">
          <span><strong>Pool created.</strong> Your config and pool are live on mainnet. <a href={solscan("tx", launched)} target="_blank" rel="noreferrer">View transaction</a></span>
          <a className="btn" href={`https://x.com/intent/tweet?text=${shareText}&url=${pageUrl}`} target="_blank" rel="noreferrer">Share on X</a>
        </div>
      )}

      <div className="spread">
        <div className="hstack" style={{ gap: 14, flexWrap: "nowrap", minWidth: 0 }}>
          <Avatar src={s.token.image} label={s.token.symbol} lg />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.02em", lineHeight: 1.2, overflowWrap: "anywhere" }}>{s.token.name}</h1>
            <div className="hstack small" style={{ gap: 8, marginTop: 4 }}>
              <span className="mono">{s.token.symbol} / {s.stock.symbol}</span>
              <span className={`chip ${status.cls}`}>{status.label}</span>
              {s.token.launchedWithStockcurve && <span className="chip">Launched with Stockcurve</span>}
              {mine && <span className="chip chip-ok">Your pool</span>}
            </div>
          </div>
        </div>
        <div className="hstack" style={{ gap: 6 }}>
          <span className="tiny muted">{updated ? `updated ${ago(Math.floor(updated / 1000))}` : ""}</span>
          <a className="btn btn-ghost" href={solscan("account", s.address)} target="_blank" rel="noreferrer">Solscan</a>
          <a className="btn btn-ghost" href={`https://jup.ag/tokens/${s.baseMint}`} target="_blank" rel="noreferrer">Jupiter</a>
        </div>
      </div>

      {s.token.description && <p className="small muted" style={{ margin: 0, whiteSpace: "pre-line", maxWidth: 760 }}>{s.token.description}</p>}

      <div className="monitor">
        <div className="stack">
          <div className="stats o1">
            <div className="stat"><div className="k">Price</div><div className="v">{usd(s.priceUsd)}</div><div className="s">{tiny(s.price)} {s.stock.symbol}</div></div>
            <div className="stat"><div className="k">Market cap</div><div className="v">{usd(s.fdvUsd, { compact: true })}</div><div className="s">{amount(s.curve.totalSupply)} supply</div></div>
            <div className="stat"><div className="k">Reserve</div><div className="v">{usd(s.quoteReserveUsd, { compact: true })}</div><div className="s">{amount(s.quoteReserve, 6)} {s.stock.symbol}</div></div>
            <div className="stat"><div className="k">Sold from curve</div><div className="v">{pct((s.sold / s.curve.totalSupply) * 100, 2)}</div><div className="s">{amount(s.sold)} tokens</div></div>
          </div>

          <div className="panel panel-pad stack-sm o2">
            <div className="spread">
              <span style={{ fontWeight: 600 }}>Progress to graduation</span>
              <span className="mono small">{s.isMigrated ? "100%" : pct(s.progressPct, s.progressPct < 1 ? 3 : 1)} · {usd(s.quoteReserveUsd, { compact: true })} of {usd(s.graduationUsd, { compact: true })}</span>
            </div>
            <div className="bar" role="progressbar" aria-valuenow={Math.round(s.progressPct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${s.isMigrated ? 100 : Math.max(s.progressPct, 0.5)}%` }} /></div>
            <span className="tiny muted">Graduates at {amount(s.graduationRaise, 4)} {s.stock.symbol}. Then Meteora&apos;s keeper moves the reserve and {amount(s.curve.lpTokens)} tokens into a DAMM v2 pool.</span>
          </div>

          <div className="panel panel-pad stack-sm o4">
            <div className="spread">
              <div className="seg" role="group" aria-label="Chart">
                <button type="button" aria-pressed={chartTab === "price"} onClick={() => setChartTab("price")}>Price chart</button>
                <button type="button" aria-pressed={chartTab === "curve"} onClick={() => setChartTab("curve")}>Bonding curve</button>
              </div>
            </div>
            {chartTab === "price" ? (
              <PoolChart address={s.address} trades={trades ?? []} usdPerStock={u} />
            ) : curveUsd ? (
              <CurveChart points={s.curve.points} supply={s.curve.totalSupply} usdPerStock={curveUsd} stockSymbol={s.stock.symbol} current={s.isMigrated ? s.graduationRaise / s.stock.multiplier : s.quoteReserve / s.stock.multiplier} label="Pool curve" />
            ) : null}
          </div>

          <div className="panel o5">
            <div className="panel-pad spread" style={{ paddingBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Recent trades</span>
              <span className="tiny muted">{pendingTx > 0 ? `${pendingTx} newer transaction${pendingTx > 1 ? "s" : ""} still loading` : "latest 20 pool transactions"}</span>
            </div>
            {trades === null ? (
              <div className="panel-pad" style={{ paddingTop: 0 }}><div className="skeleton" style={{ height: 80 }} /></div>
            ) : trades.length ? (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Side</th><th className="r">{s.stock.symbol}</th><th className="r">USD</th><th className="r">Tokens</th><th className="hide-sm">Trader</th><th className="r">When</th></tr></thead>
                  <tbody>
                    {trades.map((t, i) => (
                      <tr key={t.signature + i}>
                        <td className={t.side === "buy" ? "trade-buy" : "trade-sell"} style={{ fontWeight: 600 }}>{t.side}</td>
                        <td className="r mono">{amount(t.stock, 6)}</td>
                        <td className="r mono">{u !== null ? usd(t.stock * u) : "–"}</td>
                        <td className="r mono">{amount(t.tokens)}</td>
                        <td className="mono hide-sm">{t.trader ? short(t.trader) : ""}{t.trader === me ? " (you)" : ""}</td>
                        <td className="r"><a className="muted small" href={solscan("tx", t.signature)} target="_blank" rel="noreferrer">{ago(t.time)}</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-pad small muted" style={{ margin: 0, paddingTop: 0 }}>{pendingTx > 0 ? "Loading trades from the network…" : "No swaps yet."}</p>
            )}
          </div>
        </div>

        <div className="side">
          <div className="o3"><TradePanel pool={s.address} tokenSymbol={s.token.symbol} stockSymbol={s.stock.symbol} feeNowBps={s.feeNowBps} isMigrated={s.isMigrated} onTraded={refreshAll} /></div>

          <div className="panel panel-pad stack-sm">
            <div className="spread">
              <span style={{ fontWeight: 600 }}>Base fee now</span>
              <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{bps(s.feeNowBps)}</span>
            </div>
            {s.fees.durationSec > 0 ? (
              <>
                <FeeChart points={s.fees.points} nowSec={Math.min(s.feeElapsedSec, s.fees.durationSec)} />
                <span className="tiny muted">
                  {inWindow ? `Opening window: ${duration(s.fees.durationSec - s.feeElapsedSec)} left, falling to ${bps(s.fees.endBps)}.` : `Opening window finished. Steady fee ${bps(s.fees.endBps)}.`}
                  {s.fees.dynamic ? " Volatility fee applies on top." : ""}
                </span>
              </>
            ) : (
              <span className="tiny muted">Flat schedule{s.fees.dynamic ? ", plus volatility fee" : ""}.</span>
            )}
          </div>

          <div className="panel panel-pad stack-sm">
            <span style={{ fontWeight: 600 }}>Fees, paid in {s.stock.symbol}</span>
            <dl className="kv">
              <dt>Lifetime trading fees</dt><dd>{amount(s.lifetime.trading, 6)}{u !== null ? ` · ${usd(s.lifetime.trading * u)}` : ""}</dd>
              <dt>Unclaimed, partner</dt><dd>{amount(s.unclaimed.partner, 6)}</dd>
              <dt>Unclaimed, creator</dt><dd>{amount(s.unclaimed.creator, 6)}</dd>
              <dt>Unclaimed, protocol</dt><dd>{amount(s.unclaimed.protocol, 6)}</dd>
              <dt>Split partner / creator / protocol</dt><dd>{pct(s.fees.partnerPct, 0)} / {pct(s.fees.creatorPct, 0)} / {pct(s.fees.protocolPct, 0)}</dd>
            </dl>
            {mine && claimable > 0 && <ClaimButton pool={s.address} amountLabel={`${amount(claimable, 6)} ${s.stock.symbol}${u !== null ? ` (${usd(claimable * u)})` : ""}`} onClaimed={refreshAll} />}
            {mine && claimable === 0 && <span className="tiny muted">Nothing to claim yet. Fees from each trade land here in {s.stock.symbol}.</span>}
          </div>

          <div className="panel panel-pad stack-sm">
            <span style={{ fontWeight: 600 }}>Backing</span>
            <dl className="kv">
              <dt>{s.stock.symbol} in reserve per token sold</dt><dd>{reservePerSold !== null ? tiny(reservePerSold) : "–"}</dd>
              <dt>Current curve price</dt><dd>{tiny(s.price)}</dd>
              <dt>Reserve value</dt><dd>{usd(s.quoteReserveUsd)}</dd>
            </dl>
            <span className="tiny muted">Buyers&apos; payments sit in the pool as {s.stock.symbol} until graduation. The gap between price and reserve per token is what later buyers pay above earlier ones.</span>
          </div>

          <div className="panel panel-pad stack-sm">
            <span style={{ fontWeight: 600 }}>{s.stock.symbol} issuer controls</span>
            <div className="hstack" style={{ gap: 6 }}>
              <span className={`chip ${s.stock.paused ? "chip-bad" : "chip-ok"}`}>{s.stock.paused ? "Transfers paused" : "Transfers live"}</span>
              <span className={`chip ${s.stock.badge ? "chip-ok" : "chip-bad"}`}>{s.stock.badge ? "DBC badge" : "No badge"}</span>
              {s.stock.permanentDelegate && <span className="chip chip-warn">Permanent delegate</span>}
            </div>
            <dl className="kv">
              <dt>{s.stock.symbol} price</dt><dd>{usd(s.stock.usd)}</dd>
              <dt>Scaled UI multiplier</dt><dd>×{s.stock.multiplier.toFixed(6)}</dd>
              <dt>Next corporate action</dt><dd>{s.stock.nextMultiplierAt ? `×${s.stock.nextMultiplier} on ${new Date(s.stock.nextMultiplierAt * 1000).toISOString().slice(0, 10)}` : "none scheduled"}</dd>
            </dl>
            <span className="tiny muted">If the issuer pauses {s.stock.symbol}, buys, sells and migration all stop until it resumes.</span>
          </div>

          <div className="panel panel-pad stack-sm">
            <span style={{ fontWeight: 600 }}>After graduation</span>
            <dl className="kv">
              <dt>LP permanently locked</dt><dd>{pct(s.lp.partnerLocked + s.lp.creatorLocked, 0)}</dd>
              <dt>LP claimable</dt><dd>{pct(s.lp.partnerUnlocked + s.lp.creatorUnlocked, 0)}</dd>
              <dt>DAMM v2 pool fee</dt><dd>{s.lp.migratedFeeBps ? bps(s.lp.migratedFeeBps) : "custom"}</dd>
            </dl>
          </div>

          <div className="panel panel-pad stack-sm">
            <span style={{ fontWeight: 600 }}>Addresses</span>
            <dl className="kv" style={{ alignItems: "center" }}>
              <dt>Pool</dt><dd><Copy value={s.address} /></dd>
              <dt>Token</dt><dd><Copy value={s.baseMint} /></dd>
              <dt>Config</dt><dd><Copy value={s.config} /></dd>
              <dt>Creator</dt><dd><Copy value={s.creator} /></dd>
              <dt>Fee claimer</dt><dd><Copy value={s.feeClaimer} /></dd>
            </dl>
            <Link className="small" href="/pools">All stock-quoted pools →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
