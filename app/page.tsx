import Link from "next/link";
import PoolTable from "@/components/PoolTable";
import StockTickers from "@/components/StockTickers";

export default function Home() {
  return (
    <div className="wrap">
      <section className="hero">
        <span className="eyebrow">Meteora Dynamic Bonding Curve · tokenized stocks</span>
        <h1>Launch tokens priced in stocks, not memecoins.</h1>
        <p>
          Stockcurve configures bonding-curve launches whose quote token is a tokenized equity like NVDAx or SPYx. The reserve is held in the
          stock, fees are paid in the stock, and the opening trades like an auction instead of a sniper race.
        </p>
        <div className="hstack">
          <Link href="/create" className="btn btn-primary btn-lg">Configure a launch</Link>
          <Link href="/pools" className="btn btn-lg">Monitor pools</Link>
        </div>
        <StockTickers />
      </section>

      <section className="pillars" style={{ marginBottom: 28 }}>
        <div className="panel pillar">
          <span className="eyebrow">01 · Opening auction</span>
          <h3>Fees that price in the rush</h3>
          <p>The base fee starts high and decays over a window you choose, with a volatility fee on top. Early size pays for being early, and price discovery settles before the steady fee.</p>
        </div>
        <div className="panel pillar">
          <span className="eyebrow">02 · Stock reserve</span>
          <h3>Graduation set in dollars</h3>
          <p>You set the raise in USD; it is converted to the stock at launch, above Meteora&apos;s $750 keeper minimum. At graduation the stock reserve seeds a DAMM v2 pool with locked liquidity.</p>
        </div>
        <div className="panel pillar">
          <span className="eyebrow">03 · Issuer risk, visible</span>
          <h3>Monitor what equities add</h3>
          <p>xStocks can be paused, carry a permanent delegate, and rescale on corporate actions. Every pool page tracks those alongside price, progress, fees and trades.</p>
        </div>
      </section>

      <section className="stack" style={{ paddingBottom: 56 }}>
        <div className="spread">
          <h2 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.015em" }}>Stock-quoted pools on mainnet</h2>
          <Link href="/pools" className="small">All pools →</Link>
        </div>
        <PoolTable limit={8} compact />
      </section>
    </div>
  );
}
