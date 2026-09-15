# 07 · Test plan and demo script

## This evening's test (budget ≈ $3–5)

Wallet needs: **0.05 SOL** (launch 0.0266 + trades + fees). NVDAx is optional now: you can buy with SOL.

### A. Existing pools (free, 5 minutes)

1. Open https://stockcurve.pewcake.fun/pools → filter **Launched here**. Expect GPUPOOR and PRINT with a green "Stockcurve" chip.
2. Open PRINT. Check:
   - Loads in about a second, description shows, "Launched with Stockcurve" chip.
   - **Price chart** tab shows DexScreener (GeckoTerminal button becomes active once it indexes).
   - **Bonding curve** tab shows the curve with a marker near the start.
   - Recent trades lists your earlier buy.
   - Connect the wallet that launched it: "Your pool" chip and a **Claim** button in the Fees card (unclaimed partner + creator ≈ 0.00035 NVDAx).
3. Trade box: Buy → Pay with SOL → 0.01. A quote appears within a second with a Jupiter route. Do not buy yet.

### B. Claim fees (≈ $0.001 network fee)

4. On PRINT, press **Claim**. Simulation runs, wallet opens, confirm. Expect "Fees claimed" with a Solscan link and unclaimed going to 0 on the next refresh. NVDAx arrives in your wallet.

### C. Trade (≈ $1)

5. PRINT → Buy → Pay with **SOL** → `0.005` → Buy PRINT → confirm. Expect success note, balance update, a new row in Recent trades within ~15 s, fees increase.
6. Sell → Receive **SOL** → 100% → Sell PRINT → confirm.
7. Optional: Buy → Pay with **NVDAx** → tick "Swap directly on the curve" → tiny amount → confirm. This exercises the direct DBC path.

### D. New launch (0.0266 SOL)

8. `/create` → fill name, ticker, description, image link → keep defaults → Create pool.
   - Expect the steps list: Saving metadata → Building and simulating → Waiting for wallet → Confirming. Server steps take under a second now; most of the time is your wallet and the network.
9. You land on the new pool page with "Pool created". The pool appears in `/pools` → **Created by me** immediately.
10. Buy 0.005 SOL of it right away. If Jupiter has no route yet, switch to Pay with NVDAx + "Swap directly on the curve".

### What to note while testing

- Anything slower than ~5 s that is not the wallet prompt
- Any error message that is not plain English
- Phone layout (open on your phone): trade box directly under the price and progress

## Demo video script (2–3 minutes)

**0:00 – Hook (15 s).** "An RTX 5090 costs $1,999. That's 9.43 NVDAx. What if a token's price, its treasury and its fees were all in NVIDIA stock instead of SOL? That's Stockcurve."

**0:15 – The builder (45 s).** `/create`. Pick NVDAx (show the live prices). Point at the preview: opening $313, graduation $5,000, raise $1,000 converted to 4.72 NVDAx. Click Opening auction: "25% fee decaying to 1% over an hour: snipers pay the issuer instead of front-running the community." Show issuer controls: "NVDAx can be paused and has a permanent delegate; we make you acknowledge it." Launch: point out that it simulates on mainnet before the wallet opens.

**1:00 – The pool (45 s).** Land on the pool page. Price chart, bonding curve with the marker. "Base fee now 24% with 58 minutes left." Buy with SOL: "Jupiter routes SOL through NVDAx into the curve in one transaction." Show the trade appear and the fees card update: "80% of that fee is mine, paid in NVDAx." Press Claim.

**1:45 – The monitor (30 s).** `/pools`: "Every DBC pool on Solana priced in a tokenized stock: 439 pools, 13 graduated, across NVDA, SPY, Apple, Tesla, gold..." Filter Launched here.

**2:15 – Agents (20 s).** Terminal: `npm run agent -- status <pool>` then `buy ... --amount 0.01` dry run. "Any AI agent can launch and run a stock-quoted token and earn RWA fees over the same API."

**2:35 – Close (10 s).** "Built on Meteora DBC, xStocks and Jupiter. Live on mainnet at stockcurve.pewcake.fun."

## Submission checklist

- [ ] Stocklana: register, submit project with the live URL, GitHub link, video
- [ ] Meteora DBC track: mention the equity-tuned config and the monitor
- [ ] Clawpump track: ask Clawpump how "launch with clawpump and Meteora" should work (their docs show pump.fun and Pons only); show the agent API
- [ ] Confirm one project can be entered in all three
- [ ] GitHub repo created (code is not yet in git)
- [ ] Submit before **Friday 18 Sept 2026, 4:00 pm ET**
