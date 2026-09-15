# Stockcurve documentation

**Live:** https://stockcurve.pewcake.fun · **Code:** https://github.com/abilashblnair/stockcurve · **Built for:** Stocklana (Solana Foundation), Meteora "Best Use of DBC", Clawpump "Stocknized Agent" · **Status (2026-09-15):** live on mainnet, two real launches.

## The 30-second version

Stockcurve is a launch desk for tokens that are **priced in tokenized stocks instead of SOL or memecoins**. You pick a stock (NVDAx, SPYx, AAPLx and six more), configure a Meteora Dynamic Bonding Curve with settings designed for equity-quoted launches, and create the pool in one transaction. Buyers pay in the stock (or in SOL/USDC, which Jupiter routes through the stock), every trading fee is earned in the stock, and the curve's reserve is held in the stock until it graduates into a permanent Meteora DAMM v2 pool.

Then it monitors every stock-quoted DBC pool on Solana: price, progress, the fee in force right now, fees earned, trades, and the risks equities add (issuer pause, permanent delegate, corporate-action rescaling).

## Read in this order

| Doc | What it answers |
|---|---|
| [01-product.md](01-product.md) | What problem, for whom, why Solana and DBC, what is original |
| [02-config-explained.md](02-config-explained.md) | Every setting, the maths behind it, worked numbers |
| [03-architecture.md](03-architecture.md) | How the pieces fit, data flows, API reference, security model |
| [04-evidence.md](04-evidence.md) | Feasibility proof, mainnet results, performance measurements |
| [05-operations.md](05-operations.md) | Deploy, server layout, env, rollback, logs, known noise |
| [06-faq.md](06-faq.md) | Questions judges and users will ask, with answers |
| [07-demo-and-test-plan.md](07-demo-and-test-plan.md) | Today's test checklist and the demo video script |
| [08-roadmap.md](08-roadmap.md) | What is not built yet, ranked |
| [09-agent-api.md](09-agent-api.md) | Driving Stockcurve from an AI agent (Clawpump track) |

## Key facts to remember

- Meteora DBC program: `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`
- Supported quote stocks (all Token-2022, 8 decimals, all have a DBC token badge): NVDAx, SPYx, AAPLx, TSLAx, MSFTx, GOOGLx, MSTRx, MCDx, GLDx
- Launch cost: **0.0266 SOL** rent + fees (≈ $2.70 at $102/SOL), measured by mainnet simulation
- Default preset: opens at **≈ $313** market cap, graduates at **≈ $5,000** after raising **$1,000** of the stock (~4.7 NVDAx); 80% of supply sold on the curve, 20% paired into DAMM v2
- Opening fee **25% → 1%** over 60 minutes (exponential), plus a volatility fee; fees split 40% partner / 40% creator / 20% Meteora
- Meteora's migration keeper only graduates stock-quoted pools with a threshold of **at least $750**
- Index (2026-09-15): **439** DBC pools quoted in xStocks across 9 stocks, **13** graduated
- Real Stockcurve launches: GPU POOR (`145pjgVu745udVG2KdzseV3ePaCmY3hxxXedur4KzSKR`), Jensen's Printer (`3vfyvEJRoyVKyDBwQTG7ekkvNLLyonrVBWQfHVtd14ZU`)
