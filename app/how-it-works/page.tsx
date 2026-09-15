import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works" };

const Q = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="panel panel-pad stack-sm">
    <h2 style={{ fontSize: 17, letterSpacing: "-0.01em" }}>{title}</h2>
    <div className="small" style={{ color: "var(--ink-2)", display: "grid", gap: 8 }}>{children}</div>
  </section>
);

export default function HowItWorks() {
  return (
    <div className="wrap page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <span className="eyebrow">How it works</span>
        <h1>A bonding curve with a stock on the other side</h1>
        <p>What Stockcurve configures on Meteora&apos;s Dynamic Bonding Curve program, and why each setting is there.</p>
      </div>
      <div className="stack">
        <Q title="The quote token is a tokenized stock">
          <p>In a normal launch buyers pay SOL or USDC. Here they pay an xStock such as NVDAx or SPYx. Every buy adds the stock to the pool&apos;s reserve, every fee is collected in the stock, and the reserve stays stock until graduation.</p>
          <p>xStocks are Token-2022 tokens with extensions (pausable, permanent delegate, scaled UI amount). DBC only accepts such a quote token when Meteora has issued a token badge for it; Stockcurve checks the badge on chain before it builds anything.</p>
        </Q>
        <Q title="Opening auction fees">
          <p>DBC&apos;s fee scheduler lowers the base fee in steps from the moment the pool activates. The default starts at 25% and decays exponentially to 1% over an hour. The first minutes are when bots buy the most for the least; a high opening fee makes them pay for that, and the fee goes to the issuer instead of being lost to price impact.</p>
          <p>The volatility fee is DBC&apos;s dynamic fee: it rises when the price moves quickly and relaxes when it calms, similar to a circuit breaker on an exchange.</p>
        </Q>
        <Q title="Graduation set in dollars">
          <p>DBC measures graduation in quote tokens. Stockcurve lets you think in USD and converts at the live price when you launch, including the stock&apos;s scaled-UI multiplier. Meteora&apos;s migration keeper only moves stock-quoted pools whose threshold is at least $750, so lower targets are refused.</p>
          <p>When the reserve reaches the threshold, the keeper migrates the pool to DAMM v2: the stock reserve and the paired share of supply become permanent liquidity. By default 100% of that LP is permanently locked.</p>
        </Q>
        <Q title="One transaction, simulated first">
          <p>The browser generates two fresh keys (for the config and the token mint), the server builds a single transaction that creates both the config and the pool, and simulates it against mainnet. Only if the simulation passes does your wallet open. Your wallet pays rent and fees (about 0.04 SOL) and becomes the config owner, fee claimer and creator.</p>
          <p>Token metadata is written as immutable, so the name, ticker and links you choose are permanent.</p>
        </Q>
        <Q title="What the monitor tracks">
          <p>Price and market cap in USD, reserve and progress to graduation, the fee in force right now and how long the opening window has left, fees earned by each party, recent swaps decoded from the program&apos;s own events, and the issuer controls of the quote stock: whether transfers are paused, who holds the permanent delegate, and the next scheduled corporate action.</p>
        </Q>
        <Q title="Risks worth saying out loud">
          <p>The stock&apos;s issuer can pause transfers, which freezes trading and migration, and its permanent delegate can move tokens from any account. Scaled UI multipliers change on dividends and splits, which moves USD values. Tokenized stocks are not available to US persons. None of this is investment advice.</p>
        </Q>
        <div className="hstack">
          <Link href="/create" className="btn btn-primary">Configure a launch</Link>
          <Link href="/pools" className="btn">Browse pools</Link>
        </div>
      </div>
    </div>
  );
}
