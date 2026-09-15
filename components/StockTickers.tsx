"use client";

import { useEffect, useState } from "react";
import type { StockInfo } from "@/lib/server/stockInfo";
import { STOCKS } from "@/lib/stocks";
import { usd } from "@/lib/format";

export default function StockTickers() {
  const [stocks, setStocks] = useState<StockInfo[] | null>(null);
  useEffect(() => {
    fetch("/api/stocks").then((r) => r.json()).then((j) => setStocks(j.stocks ?? [])).catch(() => setStocks([]));
  }, []);
  return (
    <div className="tickers" aria-label="Supported quote stocks">
      {STOCKS.map((s) => {
        const info = stocks?.find((i) => i.mint === s.mint);
        return (
          <div key={s.mint} className="ticker" title={s.name}>
            <b>{s.symbol}</b>
            <span>{stocks === null ? "…" : info?.usd ? usd(info.usd) : "–"}</span>
          </div>
        );
      })}
    </div>
  );
}
