"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import type { PoolIndex } from "@/lib/server/indexer";
import type { StockInfo } from "@/lib/server/stockInfo";
import { STOCKS } from "@/lib/stocks";
import { ago, amount, pct, short, usd } from "@/lib/format";

type Filter = "all" | "here" | "bonding" | "graduated" | "mine";

export default function PoolTable({ limit, compact = false }: { limit?: number; compact?: boolean }) {
  const { publicKey } = useWallet();
  const [index, setIndex] = useState<PoolIndex | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [stock, setStock] = useState<string>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [lookup, setLookup] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/pools").then((r) => r.json()).then((j: PoolIndex) => {
        if (!alive) return;
        setIndex(j);
        if (j.scanning || !j.updatedAt) setTimeout(load, 8000);
      }).catch(() => {});
    load();
    fetch("/api/stocks").then((r) => r.json()).then((j) => {
      if (!alive || !j.stocks) return;
      setPrices(Object.fromEntries((j.stocks as StockInfo[]).map((s) => [s.symbol, (s.usd ?? 0) * s.multiplier])));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => {
    if (!index) return [];
    const needle = q.trim().toLowerCase();
    const me = publicKey?.toBase58();
    return index.pools
      .filter((p) => stock === "all" || p.stock === stock)
      .filter((p) => filter === "all" || (filter === "here" ? !!p.launchedHere : filter === "bonding" ? !p.isMigrated : filter === "graduated" ? p.isMigrated : p.creator === me))
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.symbol.toLowerCase().includes(needle) || p.baseMint.toLowerCase() === needle || p.address.toLowerCase() === needle)
      .map((p) => ({ ...p, reserveUsd: p.quoteReserve * (prices[p.stock] ?? 0) }))
      .sort((a, b) => Number(!!b.launchedHere) - Number(!!a.launchedHere) || Number(b.isMigrated) - Number(a.isMigrated) || b.reserveUsd - a.reserveUsd);
  }, [index, stock, filter, q, prices, publicKey]);

  const shown = limit ? rows.slice(0, limit) : rows;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of index?.pools ?? []) c[p.stock] = (c[p.stock] ?? 0) + 1;
    return c;
  }, [index]);

  return (
    <div className="panel">
      {!compact && (
        <div className="panel-pad stack-sm" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="spread">
            <div className="seg" role="group" aria-label="Quote stock">
              <button type="button" aria-pressed={stock === "all"} onClick={() => setStock("all")}>All</button>
              {STOCKS.filter((s) => counts[s.symbol]).map((s) => (
                <button key={s.symbol} type="button" aria-pressed={stock === s.symbol} onClick={() => setStock(s.symbol)}>{s.symbol} <span className="muted">{counts[s.symbol]}</span></button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Status">
              {(["all", "here", "bonding", "graduated", "mine"] as Filter[]).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} disabled={f === "mine" && !publicKey} title={f === "mine" && !publicKey ? "Connect a wallet" : undefined}>
                  {f === "mine" ? "Created by me" : f === "here" ? "Launched here" : f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="row2">
            <input className="input" placeholder="Filter by name or ticker" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter pools" />
            <form className="hstack" style={{ flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); if (lookup.trim()) window.location.href = `/pool/${lookup.trim()}`; }}>
              <input className="input mono" placeholder="Open any DBC pool address" value={lookup} onChange={(e) => setLookup(e.target.value)} aria-label="Pool address" />
              <button className="btn" type="submit">Open</button>
            </form>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Token</th><th>Quote</th><th className="r" title="Stock paid into the curve. For graduated pools, what was raised before migration.">Raised</th><th className="r hide-sm">Progress</th><th className="hide-sm">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.address}>
                <td>
                  <Link className="rowlink" href={`/pool/${p.address}`}>
                    <strong>{p.symbol || "?"}</strong> <span className="muted small">{p.name ? p.name.slice(0, 28) : short(p.baseMint)}</span>{p.launchedHere && <span className="chip chip-ok" style={{ marginLeft: 6 }}>Stockcurve</span>}
                  </Link>
                </td>
                <td className="mono small">{p.stock}</td>
                <td className="r mono">{p.reserveUsd ? usd(p.reserveUsd, { compact: true }) : amount(p.quoteReserve, 4)}</td>
                <td className="r hide-sm">
                  <div className="hstack" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <div className="bar" style={{ width: 80 }}><span style={{ width: `${Math.max(p.progressPct, p.progressPct > 0 ? 2 : 0)}%` }} /></div>
                    <span className="mono small" style={{ width: 52, textAlign: "right" }}>{pct(p.progressPct, p.progressPct < 10 ? 1 : 0)}</span>
                  </div>
                </td>
                <td className="hide-sm">{p.isMigrated ? <span className="chip chip-ok">Graduated</span> : <span className="chip">Bonding</span>}</td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={5} className="muted small" style={{ padding: 20 }}>
                {!index || (!index.updatedAt && index.scanning) ? `Indexing stock-quoted pools on mainnet… ${index?.progress ?? ""}` : "No pools match."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="panel-pad tiny muted spread" style={{ paddingTop: 10, paddingBottom: 12 }}>
        <span>{index?.pools.length ? `${index.pools.length} pools across ${Object.keys(counts).length} stocks` : ""}{limit && rows.length > limit ? " · " : ""}{limit && rows.length > limit ? <Link href="/pools">see all</Link> : null}</span>
        <span>{index?.scanning ? `refreshing: ${index.progress}` : index?.updatedAt ? `indexed ${ago(Math.floor(index.updatedAt / 1000))}` : ""}</span>
      </div>
    </div>
  );
}
