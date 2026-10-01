# 10 · Hackathon demo script

**For:** Superteam India / Colosseum Crypto World's Fair (Solana-only). **Length:** about 4 minutes. **Live app:** https://stockcurve.pewcake.fun

Use this script, not the September checklist in [07-demo-and-test-plan.md](07-demo-and-test-plan.md). That night's pools have already had their partner and creator fees claimed, and the pool count on screen is whatever the index says today.

## Before you start

- Wallet with **at least 0.05 SOL** on mainnet. A launch is about **0.03 SOL** of rent and fees; a tiny buy is extra.
- A little **NVDAx** is optional. SOL is enough when Jupiter has a route. If it does not, the trade box offers a direct curve swap, and that path spends the stock.
- Desktop browser, Phantom / Solflare / Backpack unlocked, on the wallet that will launch.
- Do not promise a hardcoded market cap or a hardcoded pool count. Read both off the screen. They move with the stock price and the index.

## 0:00 — Hook (20s)

Screen: home, https://stockcurve.pewcake.fun

Say: "Tokenized stocks already trade on Solana. Bonding curves almost only launch against SOL. Stockcurve is the launch desk for a curve whose reserve, price and fees are a stock: NVDAx, SPYx, and the rest of the xStocks. One transaction on Meteora's Dynamic Bonding Curve."

## 0:20 — Configure (70s)

Screen: **Launch** (`/create`). Heading: "Launch a token priced in a stock."

1. **01 Quote stock.** Click **NVDAx**. The button shows the live dollar price.
2. **02 Token.** Type a name and ticker you can say out loud (two to ten letters). One sentence of description. Metadata is immutable; say that.
3. **03 Opening and fees.** **Opening auction** is already selected. Say: "25% decaying to 1% over the first hour. The first buyers still get the cheapest tokens, but they pay the issuer for being first. That is an opening auction, not a sniper race. Flat 1% is there when you do not want one."
4. **04 Graduation.** Leave the raise at **1000 USD**. Say: "Meteora's keeper will not migrate a stock pair under $750. We convert dollars to NVDAx at the live price, including the stock's scaled-UI multiplier, when you launch."
5. **Preview** (right side). Read **Opening market cap**, **Graduation market cap**, **Raise to graduate** (dollars and NVDAx), and **Sold on curve**. Say the fee line out loud: "25% → 1% over 1h, plus a volatility fee, paid in NVDAx." The split under it is Meteora 20%, you (partner) 40%, creator 40%. Say: "This wallet is both partner and creator, so 80% of fees come back here in the stock."
6. **Issuer controls.** Point at **Transfers live**, **Permanent delegate**, and the multiplier chip. Say: "NVDAx can be paused, and the issuer's permanent delegate can move tokens out of any account, including this pool. A corporate-action multiplier rescales balances. The pool inherits all of that, so launch is blocked until you tick **I understand**." Tick it.
7. Press **Create pool quoted in NVDAx**. The steps read: Saving token metadata → Building and simulating → a green **Simulation passed** line → Waiting for your wallet → Confirming on Solana. Say: "It simulates this exact transaction on mainnet before the wallet opens. About 0.03 SOL." Confirm.

If the red note says the wallet rejected it, nothing was sent. If it says the transaction expired, nothing was charged; send it again.

## 1:30 — Pool, risks, trade (90s)

Screen: the new pool. Green banner **Pool created**, with a Solscan link.

1. Stats across the top: price, market cap, reserve, sold. **Progress to graduation** is near zero.
2. **Base fee now** should be about **25%**. The note under the chart says the opening window has time left and falls from 25% to 1%. Say: "That fee is already in the quote. It is not a surprise at signing."
3. **NVDAx issuer controls** (same chips as the form). Repeat one sentence: pause freezes buys, sells and migration; the delegate is a real admin key; the multiplier is how splits and dividends show up. Footer of every page: tokenized stocks are not offered to US persons. This is not investment advice.
4. **Price chart** may be a flat line until the first swap ("Candles: Stockcurve, from on-chain swaps"). **Bonding curve** shows the marker at the start.
5. Trade box: **Buy**, **Pay with SOL**, amount `0.01` or `0.005`. A quote appears: "You receive about …" and a Jupiter route. The yellow note repeats the opening fee. Press **Buy**. Again: simulating, then the wallet. Confirm.
6. If the quote is red and says Jupiter has no route, press **Switch to NVDAx and swap on the curve**. That checks "Swap directly on the curve" and quotes Meteora instead of Jupiter. Use a tiny NVDAx amount.

After it lands: a row in **Recent trades**, reserve and fees tick up. Balances refresh without a reload.

## 3:00 — Claim (40s)

Same page, card **Fees, paid in NVDAx**.

- Before any trade the **Claim** button is visible and disabled: "Nothing to claim yet."
- After the buy it enables, labelled **Claim** plus the NVDAx amount and a dollar figure. That amount is the partner share plus the creator share. Your wallet is both.
- Press it. The label goes **Simulating…**, then **Simulation passed. Confirm in your wallet…**. Confirm. Success: "Fees claimed" and a Solscan link. Unclaimed partner and creator go to zero; the protocol line stays, because that 20% is Meteora's.
- If this wallet is not the launcher, the card says so and names the fee claimer. There is no dead end.

## 3:40 — Index and originality (40s)

Screen: **Pools** (`/pools`).

Say, while showing the filters: "Every DBC pool on Solana quoted in a supported xStock is indexed from the program. Filter **Launched here** for pools that came through this desk, including the one we just made. **Created by me** is this wallet."

Read the live total in the table footer. Do not quote an old number.

Then the line judges need: "Stock as the quote token is not new. Hundreds of these pools already exist, and this page is the evidence. What is new is the equity-tuned config (opening-auction fee, dollar graduation above the keeper minimum, liquidity locked by default), a form that previews Meteora's own maths and simulates before the wallet opens, the equity risks on the launch and the pool page, and this cross-pool monitor. The same actions are HTTP endpoints an agent can sign. We are not claiming to have invented the curve."

## 4:20 — Close (15s)

"Built on Meteora DBC, xStocks and Jupiter. Mainnet, open source, stockcurve.pewcake.fun."

## If something misbehaves

| What you see | What to do |
|---|---|
| Preview skeleton or a red preview note | Wait, or change the raise by a dollar to retry. Launch stays disabled until the preview is valid. |
| Red simulation note before the wallet | Read it. Do not expect a signature. Not enough SOL is the usual cause. |
| Wallet closed or rejected | "Cancelled in the wallet. Nothing was sent." Press the button again. |
| "Expired" / "not confirmed yet" after signing | Nothing was charged if it expired. The note includes a reference signature. Do not immediately send a second copy of one that might still confirm. |
| Jupiter has no route | **Switch to NVDAx and swap on the curve.** |
| Claim stays disabled | The connected wallet must be the fee claimer or creator, and a trade must have paid a fee. Protocol fees are not yours. |
| Opening window already finished | Expected on PRINT and the other September launches. The fee note says "Opening window finished. Steady fee 1%." Launch a new pool to show the 25% window. |

## Same story, no wallet UI

If the room has no browser wallet, run the agent path instead. It is the same server: preview, unsigned launch, quote, claim, with fees paid in the quote stock. Dry run by default.

```bash
STOCKCURVE_URL=http://127.0.0.1:3120 npm run agent:demo
```

Walkthrough, curl, and what each JSON field means: [11-agent-for-judges.md](11-agent-for-judges.md).
