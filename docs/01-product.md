# 01 · Product

## The problem

Tokenized stocks (Backed's xStocks: NVDAx, SPYx, AAPLx...) already trade on Solana, but almost everything built around them is a copy of a brokerage app: swap in, swap out. Meanwhile the most active launch primitive on Solana, the bonding curve, is used almost only for memecoins paired with SOL.

That leaves three gaps:

1. **Issuers have no tooling** for launches whose reserve is equity. A community fund, an index club, a creator token or an agent token that wants its treasury in NVDA instead of SOL has to hand-configure a DBC curve through the SDK.
2. **Default curve settings are built for memecoin sniping.** Flat fees and SOL thresholds do not fit an asset where the other side of every trade is a stock with a real-world price.
3. **Nobody shows the equity-specific risks.** xStocks can be paused by their issuer, carry a permanent delegate that can move tokens from any account, and rescale balances on corporate actions. A pool quoted in them inherits all of that silently.

## Who it is for

| User | What they do with Stockcurve |
|---|---|
| **Issuers / communities** | Launch a token whose curve reserve and fee income are a stock, with an opening-auction fee and locked liquidity, without touching the SDK |
| **AI agents** (Clawpump) | Launch and run a token over a plain HTTP API, earn trading fees in a stock (RWA income), claim them |
| **Traders** | Buy with SOL, USDC or the stock itself; see the fee in force right now before trading |
| **Researchers / judges** | See every stock-quoted DBC pool on Solana in one place, with progress and graduation status |

## What it does

1. **Configure** (`/create`): pick the quote stock, token details, a fee preset (Opening auction, Soft open, Flat 1%) or custom schedule, graduation in USD, liquidity lock, fee split, supply. A live preview runs Meteora's own curve maths: opening and graduation market cap, raise needed, share sold on the curve, fee chart, fee split, and the stock's issuer controls.
2. **Launch**: one transaction creates the DBC config and the pool. It is simulated on mainnet before the wallet opens. Metadata is hosted by Stockcurve and written on chain as immutable.
3. **Trade** (pool page): buy or sell with SOL, USDC or the stock. Jupiter routes SOL/USDC through the stock into the curve (and into DAMM v2 after graduation). For brand-new pools Jupiter has not indexed yet, a direct curve swap is available. Every trade is simulated first.
4. **Monitor** (pool page): price, market cap, reserve, progress to graduation, bonding curve with the pool's position, a candlestick price chart in USD (GeckoTerminal candles, following the token to its DAMM v2 pool after graduation, or candles Stockcurve builds from the pool's own swap events), base fee now and time left in the opening window, fees earned per party, backing, recent trades, issuer controls, post-graduation LP terms.
5. **Claim**: the pool's fee claimer and creator see a Claim button for fees earned in the stock.
6. **Index** (`/pools`): every DBC pool on Solana quoted in a supported stock, filterable by stock, status, "Launched here" and "Created by me".
7. **Agent API**: every action is an HTTP endpoint that returns an unsigned, simulated transaction. `scripts/agent.ts` drives the whole lifecycle from a keypair.

## Why Solana, why Meteora DBC

- **The assets are here.** xStocks are native Solana Token-2022 tokens with deep Jupiter liquidity.
- **DBC is the only launch primitive that accepts a Token-2022 stock as the quote token.** Meteora issues a "token badge" per mint; every xStock we support has one (checked on chain).
- **Configurable fees and graduation.** DBC's fee scheduler, dynamic fee, USD-convertible thresholds and DAMM v2 migration with locked LP are exactly the knobs an equity-quoted launch needs.
- **One transaction, sub-cent fees.** Creating a config and pool costs 0.0266 SOL; a trade costs a fraction of a cent.
- **Composability.** Jupiter already routes SOL → NVDAx → a new Stockcurve pool in one swap, minutes after launch.

## What is original (and what is not)

Honest framing matters because judges can check: **439 DBC pools already use xStocks as the quote token** (our own index, 2026-09-15). "Stock as quote" alone is not new. What Stockcurve adds:

1. **An equity-tuned configuration** rather than memecoin defaults: opening-auction fee decay, volatility fee, graduation expressed in USD with keeper-minimum headroom, 100% locked LP by default, scaled-UI-aware conversions.
2. **Issuer tooling** that turns a 40-parameter SDK call into a form with a mathematically exact preview and pre-flight simulation.
3. **Risk surfacing** specific to tokenized equities: pause state, permanent delegate, corporate-action multiplier and schedule, on every launch and pool page.
4. **The first cross-pool monitor** of stock-quoted DBC pools, decoding swaps from the program's own events.
5. **An agent-ready API** so autonomous agents can run RWA-quoted tokens and earn fees in stocks.

## Business model (post-hackathon)

- Optional platform fee on Jupiter-routed trades (the same 20 bps model Pewcake already runs), or a partner share of trading fees on configs Stockcurve creates for issuers who opt in.
- Paid issuer features: alerts on graduation and issuer pause, branded launch pages, multi-pool dashboards.
