# 08 · Roadmap and suggestions

Ranked by value for the hackathon deadline first, then after.

## Before submission (high value, small)

| # | Item | Why | Effort |
|---|---|---|---|
| 1 | **GitHub repo** with this README and docs | Required link for judges; shows open-source work | 30 min |
| 2 | **Demo video** following [07](07-demo-and-test-plan.md) | Judges watch this first | 1–2 h |
| 3 | **Clarify Clawpump's requirement** with their team | Their docs do not show Meteora or stock pairing; the track requires it | message |
| 4 | **Social share image per pool** (Open Graph) | Links shared on X show the token, stock, price and progress | 1–2 h |
| 5 | **Separate Helius key for Stockcurve** | The index scan shares Pewcake's rate limit today | 10 min + account |

## Next (medium)

| # | Item | Why |
|---|---|---|
| 6 | **Alerts**: Telegram/X when a pool graduates, when the quote stock is paused, when a corporate action is scheduled | Issuers need to know without watching the page. Pewcake's Telegram bot can be reused |
| 7 | **"My launches" dashboard** with total fees earned in stock and USD across pools, claim-all | Makes the "earn in stocks" story tangible |
| 8 | **Platform fee** on Jupiter-routed trades (Pewcake's 20 bps model) | Revenue |
| 9 | **Reference price overlay**: stock price over time next to the token price (e.g. Pyth equity feeds) | Shows how much of a token's move is the stock vs. the token |
| 10 | **Trade history beyond 20 transactions**, paged, and per-wallet PnL | Monitoring depth |
| 11 | **Market-hours awareness**: warn when US markets are closed (xStock liquidity thins) and show next open | Equity-specific context |

## Later (bigger bets)

| # | Item | Why |
|---|---|---|
| 12 | **Basket quote tokens**: launch against an index basket (e.g. a vault token holding NVDA + MSFT + GOOGL) | Tokens priced in a portfolio, not a single stock |
| 13 | **Issuer config templates** as reusable partner configs (one config, many pools), with Stockcurve as partner for revenue share | Scales to launchpads and agent platforms |
| 14 | **Agent SDK package** (npm) wrapping the HTTP API with typed calls | Clawpump and other agent frameworks can integrate in minutes |
| 15 | **Graduation assistant**: show the DAMM v2 pool after migration, LP positions, claim LP fees | Completes the lifecycle |
| 16 | **Compliance hooks**: geo-block regions where xStocks are unavailable; surface issuer terms | Needed for real issuers |

## Known limitations today

- Only the 9 listed xStocks are supported (all verified on chain); new ones need a badge check and a line in `lib/stocks.ts`.
- Graduation below $750 is not possible (Meteora keeper rule).
- After graduation the pool page shows the final bonding state and routes trades through Jupiter; DAMM v2 LP management is not built.
- The index refreshes every 30 minutes; pools launched elsewhere appear after the next scan (pools launched here appear immediately).
- Recent trades cover the last 20 pool transactions.
- Code is not in git yet.
