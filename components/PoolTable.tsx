"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import type { IndexedPool, PoolIndex } from "@/lib/server/indexer";
import type { StockInfo } from "@/lib/server/stockInfo";
import { STOCKS } from "@/lib/stocks";
import { ago, amount, bps, duration, pct, short, usd } from "@/lib/format";

type Filter = "all" | "here" | "bonding" | "graduated" | "mine";

const FILTERS: Filter[] = ["all", "here", "bonding", "graduated", "mine"];
const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  here: "Launched here",
  bonding: "Bonding",
  graduated: "Graduated",
  mine: "Created by me",
};

function feeTitle(p: IndexedPool): string {
  if (p.isMigrated) return "Graduated to DAMM v2. The curve fee no longer applies; the reserve is what the curve raised in the stock.";
  if (p.feeNowBps == null) return "Base fee shows up once this version of the index has scanned the pool.";
  if (p.feeSchedule === "rate-limit") return `Size-based fee. Base ${bps(p.feeNowBps)}, paid in ${p.stock}.`;
  if (p.feeSchedule === "decay" && p.feeEndBps != null && p.feeNowBps !== p.feeEndBps) {
    const sec = p.feeDurationSec ?? 0;
    const window = sec >= 86400 ? ` over ${Math.round(sec / 86400)}d` : sec ? ` over ${duration(sec)}` : "";
    return `Opening auction ${bps(p.feeStartBps ?? p.feeNowBps)} → ${bps(p.feeEndBps)}${window}. Now ${bps(p.feeNowBps)}, paid in ${p.stock}.`;
  }
  if (p.feeSchedule === "decay") return `Opening window finished. Steady fee ${bps(p.feeEndBps ?? p.feeNowBps)}, paid in ${p.stock}.`;
  return `Flat fee ${bps(p.feeNowBps)}, paid in ${p.stock}.`;
}

function FeeCell({ p }: { p: IndexedPool }) {
  if (p.isMigrated) return <span className="muted small" title={feeTitle(p)}>DAMM</span>;
  if (p.feeNowBps == null) return <span className="muted" title={feeTitle(p)}>–</span>;
  const moving = p.feeSchedule === "decay" && p.feeEndBps != null && p.feeNowBps !== p.feeEndBps;
  return (
    <span className="mono small" title={feeTitle(p)}>
      {bps(p.feeNowBps)}
      {moving ? <span className="muted"> → {bps(p.feeEndBps!)}</span> : null}
    </span>
  );
}

export default function PoolTable({ limit, compact = false }: { limit?: number; compact?: boolean }) {
  const { publicKey } = useWallet();
  const [index, setIndex] = useState<PoolIndex | null>(null);
  const [stocks, setStocks] = useState<StockInfo[] | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stock, setStock] = useState<string>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [lookup, setLookup] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      fetch("/api/pools")
        .then(async (r) => {
          const j = (await r.json().catch(() => null)) as PoolIndex | { error?: string } | null;
          if (!r.ok || !j || !Array.isArray((j as PoolIndex).pools)) {
            throw new Error((j as { error?: string } | null)?.error || "The pool index did not respond.");
          }
          return j as PoolIndex;
        })
        .then((j) => {
          if (!alive) return;
          setIndex(j);
          setLoadError(null);
          if (j.scanning || !j.updatedAt) timer = setTimeout(load, 8000);
        })
        .catch((e) => {
          if (!alive) return;
          setLoadError(e instanceof Error ? e.message : "Could not load the pool index.");
          timer = setTimeout(load, 8000);
        });
    load();
    fetch("/api/stocks")
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.stocks) throw new Error(j?.error || "Stock controls did not load.");
        return j.stocks as StockInfo[];
      })
      .then((list) => {
        if (alive) setStocks(list);
      })
      .catch((e) => {
        if (alive) setStockError(e instanceof Error ? e.message : "Stock controls did not load.");
      });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [reload]);

  const prices = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of stocks ?? []) out[s.symbol] = (s.usd ?? 0) * s.multiplier;
    return out;
  }, [stocks]);
  const bySymbol = useMemo(() => {
    const out: Record<string, StockInfo> = {};
    for (const s of stocks ?? []) out[s.symbol] = s;
    return out;
  }, [stocks]);

  const stockCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of index?.pools ?? []) c[p.stock] = (c[p.stock] ?? 0) + 1;
    return c;
  }, [index]);

  const inStock = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (index?.pools ?? []).filter((p) => {
      if (stock !== "all" && p.stock !== stock) return false;
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle) || p.symbol.toLowerCase().includes(needle) || p.baseMint.toLowerCase() === needle || p.address.toLowerCase() === needle;
    });
  }, [index, stock, q]);

  const me = publicKey?.toBase58();
  const statusCount = (f: Filter) => {
    if (f === "all") return inStock.length;
    if (f === "here") return inStock.filter((p) => p.launchedHere).length;
    if (f === "bonding") return inStock.filter((p) => !p.isMigrated).length;
    if (f === "graduated") return inStock.filter((p) => p.isMigrated).length;
    return me ? inStock.filter((p) => p.creator === me).length : null;
  };

  const rows = useMemo(() => {
    return inStock
      .filter((p) => filter === "all" || (filter === "here" ? !!p.launchedHere : filter === "bonding" ? !p.isMigrated : filter === "graduated" ? p.isMigrated : p.creator === me))
      .map((p) => ({ ...p, reserveUsd: p.quoteReserve * (prices[p.stock] ?? 0) }))
      .sort((a, b) => Number(!!b.launchedHere) - Number(!!a.launchedHere) || Number(b.isMigrated) - Number(a.isMigrated) || b.reserveUsd - a.reserveUsd);
  }, [inStock, filter, prices, me]);

  const shown = limit ? rows.slice(0, limit) : rows;
  const graduated = (index?.pools ?? []).filter((p) => p.isMigrated).length;
  const launchedHere = (index?.pools ?? []).filter((p) => p.launchedHere).length;
  const quoteStocks = Object.keys(stockCounts).length;
  const filtered = filter !== "all" || stock !== "all" || q.trim().length > 0;
  const scanning = !!index?.scanning;
  const waiting = !index || (!index.updatedAt && scanning && index.pools.length === 0);

  const listedStocks = (stocks ?? []).filter((s) => stock === "all" || s.symbol === stock);
  const paused = listedStocks.filter((s) => s.paused);
  const delegated = listedStocks.filter((s) => s.permanentDelegate);
  const scheduled = listedStocks.filter((s) => s.nextMultiplierAt);

  const empty = !index
    ? "Loading the pool index…"
    : waiting
      ? `Reading stock-quoted DBC configs from mainnet… ${index.progress ?? ""}`.trim()
      : index.error && index.pools.length === 0
        ? index.error
        : filter === "mine" && !me
          ? "Connect the wallet that launched. Created by me matches the pool creator."
          : filter === "mine"
            ? "No pools from this wallet yet. A launch shows up here right away."
            : filter === "here"
              ? "No pools in this view were launched on this desk. Stockcurve launches carry a green chip, once the index has read their metadata."
              : q.trim()
                ? "No pools match that name, ticker, or address."
                : stock !== "all"
                  ? `No ${stock} pools in the index yet.`
                  : "No pools match these filters.";

  return (
    <div className="panel">
      {!compact && (
        <div className="panel-pad stack-sm" style={{ borderBottom: "1px solid var(--line)" }}>
          {!!index?.pools.length && (
            <div className="stack-sm">
              <p className="small" style={{ margin: 0 }}>
                <strong className="mono">{index.pools.length}</strong> pools
                {" · "}
                <strong className="mono">{graduated}</strong> graduated to DAMM v2
                {" · "}
                <strong className="mono">{launchedHere}</strong> launched here
                {" · "}
                <strong className="mono">{quoteStocks}</strong> quote stocks.
                Reserves and trading fees are the quote stock.
                {filtered ? <> Showing <strong className="mono">{rows.length}</strong>.</> : null}
              </p>
              {stocks ? (
                <div className="hstack">
                  {paused.length ? (
                    <span className="chip chip-bad" title="The issuer paused transfers. Buys, sells and migration that move this stock will fail.">
                      {paused.map((s) => s.symbol).join(", ")} paused
                    </span>
                  ) : (
                    <span className="chip chip-ok">Transfers live</span>
                  )}
                  {delegated.length > 0 && (
                    <span className="chip chip-warn" title={delegated.map((s) => `${s.symbol}: ${s.permanentDelegate}`).join("\n")}>
                      Permanent delegate{delegated.length === listedStocks.length ? " on every quote stock" : ` on ${delegated.map((s) => s.symbol).join(", ")}`}
                    </span>
                  )}
                  {scheduled.length > 0 && (
                    <span className="chip chip-warn" title="A scaled-UI multiplier changes displayed balances and USD values when it takes effect.">
                      Corporate action scheduled: {scheduled.map((s) => s.symbol).join(", ")}
                    </span>
                  )}
                  <span className="tiny muted">The issuer can pause the stock, and a permanent delegate can move it out of a pool&apos;s reserve.</span>
                </div>
              ) : stockError ? (
                <p className="tiny muted" style={{ margin: 0 }}>Issuer controls did not load ({stockError}). The pool list is still the on-chain index.</p>
              ) : (
                <p className="tiny muted" style={{ margin: 0 }}>Loading issuer controls for the quote stocks…</p>
              )}
            </div>
          )}
          <div className="spread">
            <div className="seg" role="group" aria-label="Quote stock">
              <button type="button" aria-pressed={stock === "all"} onClick={() => setStock("all")}>All</button>
              {STOCKS.filter((s) => stockCounts[s.symbol]).map((s) => (
                <button key={s.symbol} type="button" aria-pressed={stock === s.symbol} onClick={() => setStock(s.symbol)}>
                  {s.symbol} <span className="muted">{stockCounts[s.symbol]}</span>
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Status">
              {FILTERS.map((f) => {
                const n = statusCount(f);
                return (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} title={f === "mine" && !me ? "Connect a wallet. This matches the pool creator." : undefined}>
                    {FILTER_LABEL[f]}{n != null ? <span className="muted"> {n}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="row2">
            <input className="input" placeholder="Name, ticker, or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter pools" />
            <form className="hstack" style={{ flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); if (lookup.trim()) window.location.href = `/pool/${lookup.trim()}`; }}>
              <input className="input mono" placeholder="Open any DBC pool address" value={lookup} onChange={(e) => setLookup(e.target.value)} aria-label="Pool address" />
              <button className="btn" type="submit">Open</button>
            </form>
          </div>
        </div>
      )}
      {(loadError || index?.error) && (
        <div className="panel-pad" style={{ paddingBottom: 0 }}>
          <div className="note note-bad">
            {loadError ?? index?.error}
            {index?.pools.length ? " Showing the pools already indexed." : " The page keeps trying."}
            {" "}
            <button type="button" className="btn" style={{ height: 28, marginLeft: 8 }} onClick={() => setReload((n) => n + 1)}>Retry</button>
          </div>
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Token</th>
              <th>Quote</th>
              <th className="r" title="Stock paid into the curve. For a graduated pool, what the curve raised before migration.">Raised</th>
              <th className="r hide-sm" title="Share of the graduation threshold raised in the quote stock.">Progress</th>
              <th className="hide-sm" title="Base fee in the quote stock. DAMM means the curve has graduated.">Fee</th>
              <th className="hide-sm">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const info = bySymbol[p.stock];
              return (
                <tr key={p.address}>
                  <td>
                    <Link className="rowlink" href={`/pool/${p.address}`}>
                      <strong>{p.symbol || "?"}</strong> <span className="muted small">{p.name ? p.name.slice(0, 28) : short(p.baseMint)}</span>{p.launchedHere && <span className="chip chip-ok" style={{ marginLeft: 6 }}>Stockcurve</span>}
                    </Link>
                  </td>
                  <td>
                    <span className="mono small">{p.stock}</span>
                    {info?.paused && <span className="chip chip-bad" style={{ marginLeft: 6 }} title="Transfers of this stock are paused.">Paused</span>}
                  </td>
                  <td className="r mono">{p.reserveUsd ? usd(p.reserveUsd, { compact: true }) : amount(p.quoteReserve, 4)}</td>
                  <td className="r hide-sm">
                    <div className="hstack" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <div className="bar" style={{ width: 80 }}><span style={{ width: `${Math.max(p.progressPct, p.progressPct > 0 ? 2 : 0)}%` }} /></div>
                      <span className="mono small" style={{ width: 52, textAlign: "right" }}>{pct(p.progressPct, p.progressPct < 10 ? 1 : 0)}</span>
                    </div>
                  </td>
                  <td className="hide-sm"><FeeCell p={p} /></td>
                  <td className="hide-sm">{p.isMigrated ? <span className="chip chip-ok">Graduated</span> : <span className="chip">Bonding</span>}</td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr><td colSpan={6} className="muted small" style={{ padding: 20 }}>
                {waiting
                  ? compact
                    ? `Indexing stock-quoted pools on mainnet… ${index?.progress ?? ""}`.trim()
                    : `${empty}. A first pass reads every config from the chain, a few at a time, so a cold public RPC takes several minutes. Pools appear as each stock finishes. You can open a pool address above without waiting.`
                  : empty}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="panel-pad tiny muted spread" style={{ paddingTop: 10, paddingBottom: 12 }}>
        <span>
          {index?.pools.length ? `${index.pools.length} pools · ${graduated} graduated · ${launchedHere} launched here` : waiting ? "Index not ready yet" : ""}
          {limit && rows.length > limit ? " · " : ""}
          {limit && rows.length > limit ? <Link href="/pools">see all</Link> : null}
        </span>
        <span>{scanning ? `refreshing: ${index?.progress || "scanning"}` : index?.updatedAt ? `indexed ${ago(Math.floor(index.updatedAt / 1000))}` : ""}</span>
      </div>
    </div>
  );
}
