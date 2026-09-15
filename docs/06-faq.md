# 06 · FAQ

## About the idea

**Why would anyone price a token in a stock instead of SOL or USDC?**
Because the reserve and the fee income then track an asset with real-world value instead of a memecoin-correlated one. An index club, a fan community of a company, or an AI agent that wants RWA income can hold NVDA or the S&P 500 as its treasury by construction. Every buy adds the stock to the pool; every fee paid to the issuer is the stock.

**439 stock-quoted DBC pools already exist. What is new?**
Stock as quote is not new, and we say so. What is new: an equity-tuned configuration (opening-auction fee decay, volatility fee, USD graduation with keeper headroom, locked LP by default), issuer tooling with an exact preview and simulation, visible equity risks (pause, permanent delegate, corporate actions), a cross-pool monitor of every stock-quoted DBC pool, and an agent API. See [01-product.md](01-product.md#what-is-original-and-what-is-not).

**Isn't this just a memecoin launchpad with a different quote token?**
The launch mechanics are the same primitive, deliberately: DBC is battle-tested. The difference is what the configuration optimises for (orderly price discovery instead of sniping), what the reserve is (equity), and what the monitor warns about (issuer controls). The first two launches are memes; the tooling is built for any issuer.

**Why an "opening auction" fee?**
On a bonding curve the earliest buyers get the best price and bots win the first seconds. A 25% fee decaying to 1% over an hour makes being first expensive, pays that premium to the issuer and creator (80% of fees), and lets price discovery settle before normal trading. It mirrors exchange opening auctions.

## About the stock side

**What happens if the stock issuer pauses transfers?**
xStocks have a Pausable extension. If paused, every buy, sell and the migration stop until it resumes, because they all move the stock. Stockcurve checks the pause flag live, blocks new launches and trades while paused, and shows it on every pool page.

**What is the permanent delegate?**
A Token-2022 extension that lets the issuer move tokens out of any account, including a pool's reserve. It exists for regulatory compliance (e.g. court orders). It is a real risk, so the builder requires an explicit "I understand" before launching and the pool page shows it.

**What is the scaled UI multiplier?**
xStocks use Token-2022's scaled UI amount to apply dividends and splits without moving tokens: displayed balance = raw balance × multiplier (NVDAx ≈ 1.0017 today). DBC works in raw units, so Stockcurve applies the multiplier when converting dollars to thresholds, when showing stock amounts, and it shows any scheduled change.

**Can US users use it?**
Tokenized stocks (xStocks) are not offered to US persons. The site says so in the footer. Stockcurve does not custody anything, but pools inherit the stock's eligibility rules.

**Where do prices come from?**
Stock USD prices: Jupiter's price API (cached 30 s). Pool prices: computed from the pool's sqrt price on chain. Chart: GeckoTerminal USD candles when it has the pool (for graduated tokens, their DAMM v2 pool); otherwise candles built from the pool's own swap events at the pool price after each trade.

## About the mechanics

**How much does a launch cost?** 0.0266 SOL (rent + fees), measured by mainnet simulation.

**Can a launch fail after I sign?** It is simulated with your exact transaction first, so failures after signing are rare (e.g. the blockhash expiring on a congested network). The page re-broadcasts until confirmation or expiry, and an expired transaction charges nothing.

**Why can't I set graduation below $750?** Meteora's migration keeper only migrates stock-quoted pools whose threshold is worth at least $750. A lower threshold would create a pool that never graduates automatically.

**Who can claim fees?** The config's fee claimer (partner) and the pool creator. Launching through Stockcurve makes your wallet both, so 80% of trading fees are yours. Meteora keeps 20%.

**What happens at graduation?** When the reserve reaches the threshold, Meteora's keeper moves the stock reserve and the paired share of supply into a DAMM v2 pool. By default 100% of that liquidity is permanently locked (50% partner, 50% creator). Trading continues on DAMM v2 and Jupiter routes to it.

**Is the token metadata editable?** No. Stockcurve creates tokens with immutable metadata so holders know the name and links cannot change.

**Why is the chart not a DexScreener embed?** DexScreener indexes these pools but cannot price a pair quoted in an xStock in USD, so its embedded chart stays on "Loading pair…" forever. Stockcurve draws its own candlestick chart instead: GeckoTerminal candles when available, fetched from your browser, or candles built from the pool's own swaps. The GeckoTerminal and DexScreener links below the chart still open those sites.

**Why does a graduated pool's chart show a different pool address?** After graduation the bonding-curve pool stops trading. The chart follows the token to its most liquid pool, normally the DAMM v2 pool created at migration.

**Why Jupiter for trades?** It lets people pay with SOL or USDC in one transaction (SOL → stock → curve) and routes to DAMM v2 after graduation. For a pool Jupiter has not indexed yet, the trade box has a direct curve swap option paid in the stock.

## About the build

**Is it open source?** The code is in `stockcurve/`. It uses Meteora's open-source DBC SDK, Solana web3.js, SPL Token, Next.js, and Jupiter's public API.

**Does the server hold private keys?** No. It builds and simulates unsigned transactions. Wallets or agents sign.

**Why is it hosted on pewcake.fun?** Speed of delivery: the same free server and Caddy already ran Pewcake. Stockcurve runs as an isolated container with its own memory cap and data volume.

**How do you know the maths is right?** The preview uses the SDK's own functions (`buildCurve`, `getMigrationThresholdPrice`, `getDeltaAmountQuoteUnsigned`, `getBaseFeeNumeratorByPeriod`) and every transaction is simulated on mainnet. The go/no-go scripts in `scripts/` reproduce the evidence.
