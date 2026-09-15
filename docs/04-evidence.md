# 04 · Evidence

Everything here was measured on Solana mainnet on 2026-09-15.

## Feasibility (go/no-go)

### Stage 1: read-only probe (`npm run probe`)

| | NVDAx | SPYx |
|---|---|---|
| Token program | Token-2022, 8 decimals | Token-2022, 8 decimals |
| Extensions | MetadataPointer, PermanentDelegate, DefaultAccountState, ScaledUiAmountConfig, PausableConfig, ConfidentialTransferMint, TransferHook (program unset), TokenMetadata | same |
| DBC token badge | yes | yes |
| DBC configs quoted in it | 173 | 74 |
| Pools | 166 | 89 |
| Pools that traded | 86 | 61 |
| Graduated to DAMM v2 | 2 | 5 |

Every other supported xStock (AAPLx, TSLAx, MSFTx, GOOGLx, MSTRx, MCDx, GLDx) also has a badge.

**Why the badge matters:** DBC only accepts a Token-2022 quote mint with extensions like these if Meteora has created a token badge for it. Without one, no launch is possible.

### Stage 2: mainnet simulation (`npm run simulate -- NVDAx`)

| Test | NVDAx | SPYx |
|---|---|---|
| Our preset: create config + pool in one transaction | OK, 1149 / 1232 bytes, ~150k CU | OK, same |
| Buy then sell in one transaction on an existing bonding pool | OK, 720 bytes, ~90k CU, Token-2022 invoked | OK |

### Stage 3: real launches through the live site

| Token | Pool | Mint | Notes |
|---|---|---|---|
| GPU POOR (GPUPOOR) | `145pjgVu745udVG2KdzseV3ePaCmY3hxxXedur4KzSKR` | `Hru3hcGLv3Z2s8ynhCgBheuYER4YtN3VZQAbHX6ZdgVV` | Bought and sold back |
| Jensen's Printer (PRINT) | `3vfyvEJRoyVKyDBwQTG7ekkvNLLyonrVBWQfHVtd14ZU` | `yQsjfzTPFQbfDuLbjYvjo1bxbV8nMuFfmgyo9NgtgXS` | ~$0.31 of NVDAx bought; fees accrued to partner and creator in NVDAx; indexed by DexScreener within the hour |

Within an hour of launch, **Jupiter routed SOL → NVDAx → PRINT** (route: Quantum → Whirlpool → Dynamic Bonding Curve) and USDC → PRINT, so buyers do not need to hold the stock.

## Market landscape (our index)

| Stock | Pools | | Stock | Pools |
|---|---|---|---|---|
| NVDAx | 166 | | MCDx | 42 |
| SPYx | 89 | | TSLAx | 27 |
| AAPLx | 46 | | GOOGLx | 20 |
| GLDx | 19 | | MSFTx | 15 |
| MSTRx | 15 | | **Total** | **439**, 13 graduated |

## Performance (live server)

Measured with the real PRINT pool after the performance work:

| Operation | Before | After |
|---|---|---|
| Pool page data, first load | 17.0 s | 0.4–1.1 s |
| Recent trades | blocked the page for up to 20–40 s | separate call, ≤ 2.5 s, fills in the background |
| Direct curve trade build | 44 s | 0.4 s |
| Launch transaction build + simulation | not measured | 0.5–0.9 s |
| Jupiter trade build + simulation | – | 0.4–0.5 s |
| Metadata upload | – | 0.07 s |

Root causes found and fixed:

1. `getTransactions` on Helius is slow (20–40 s) the first time it serves a transaction. Trades moved to their own endpoint, memoised by signature, fetched in the background.
2. The SDK's `getCurrentPoint` waits on `getBlockTime` for the newest slot, which is often not available yet. Timestamp-activated pools now use the server clock.
3. Pool metadata hosted by Stockcurve was fetched over HTTPS through Caddy from inside the same server. It is now read from disk.
4. Nothing was cached per pool. Snapshot (4 s), pool state (4 s), config (1 h, immutable), supply (1 h) are now cached, so many viewers cost one RPC read.

## Charts

- DexScreener indexed both launches within the hour but returns no USD price for pairs quoted in NVDAx (`priceUsd` empty), which is why its embed never rendered. Replaced with a native chart.
- GeckoTerminal prices xStock pairs (BAG/MCDx DAMM v2: $67K liquidity, $455K 24 h volume) and allows browser requests (`access-control-allow-origin: *`), but answered 429 to the server's IP on the first calls. Candles are fetched from the browser.
- Graduated pools: the chart follows the token to its DAMM v2 pool (BAG → `F9h1hHpUy1S3vKiC3AAveC4rVbzj8ikkd1VzzigsxSsu`).
- On-chain candles use the post-trade pool price from each swap event. For GPU POOR the fee-inclusive sell price was 10% below the pool price (opening fee); using the event's price keeps the chart range at a realistic 0.5%.

## Verified behaviours

- Settings below $750, under 10% locked LP, or LP not summing to 100% are refused with plain messages.
- A wallet with no SOL gets "Not enough SOL for rent and fees" before any wallet prompt.
- A metadata link pointing at localhost, or one that makes the transaction exceed 1232 bytes, is refused before simulation.
- A sell without tokens, a claim by a wallet that does not own the pool, and a buy exceeding balance are refused before signing.
- Page layout has no horizontal overflow at 375 px; on phones the trade box sits directly under price and progress.
