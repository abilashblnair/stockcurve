# 02 · The configuration, explained

Source of truth: `lib/settings.ts` (settings, presets, checks) and `lib/preset.ts` (conversion to the SDK's `ConfigParameters` via `buildCurve`).

## The settings

| Setting | Default | Range | What it does on chain |
|---|---|---|---|
| Quote stock | NVDAx | 9 xStocks | `quoteMint` of the DBC config. Buyers pay it, fees accrue in it, the reserve holds it |
| Fee schedule | Exponential | exponential / linear / flat | DBC `baseFee.baseFeeMode` (FeeSchedulerExponential / Linear) |
| Opening fee | 25% | 0.25%–99% | `cliffFeeNumerator`, the fee at activation |
| Steady fee | 1% | ≥ 0.25% | Fee after the opening window ends |
| Opening window | 60 min | 1 min – 24 h | `numberOfPeriod × periodFrequency`. We use about 2 steps per minute (60 min = 120 steps of 30 s) |
| Volatility fee | on | on / off | DBC dynamic fee: rises when price moves fast within a short window, decays when calm |
| Raise to graduate | $1,000 | ≥ $750 | `migrationQuoteThreshold`, converted to the stock at the live price when you launch |
| Supply paired at graduation | 20% | 5–60% | `percentageSupplyOnMigration`: share of supply that goes into the DAMM v2 pool; the rest is sold on the curve |
| LP permanently locked (partner / creator) | 50% / 50% | min 10% locked in total | Liquidity split and lock of the DAMM v2 position after migration |
| LP claimable (partner / creator) | 0% / 0% | | Portion of that LP the wallet can withdraw later |
| Creator share of fees | 50% | 0–100% | `creatorTradingFeePercentage` of the non-protocol fee |
| Pool fee after graduation | 1% | 0.25 / 0.3 / 1 / 2 / 4 / 6% | `migrationFeeOption`: the DAMM v2 fee tier |
| Total supply | 1,000,000,000 | 1M–1T | Fixed supply, 6 decimals, SPL token, immutable metadata |

Fixed choices (not exposed): SPL base token, 6 decimals, immutable token metadata, timestamp activation, fees collected in the quote token (the stock), migration to DAMM v2 (DAMM v1 is deprecated for new pools), no locked vesting, zero migration fee.

## Presets

| Preset | Fee | Window | Volatility | Paired | For |
|---|---|---|---|---|---|
| **Opening auction** | 25% → 1% exponential | 60 min | on | 20% | Default. Early size pays a premium that goes to the issuer instead of being lost to snipers |
| **Soft open** | 5% → 1% linear | 15 min | on | 25% | Communities that already know roughly where the price should be |
| **Flat 1%** | 1% flat | none | on | 20% | Simplest to explain |

## Why an opening auction

On a bonding curve the first buyers get the lowest price. Bots exploit this in the first seconds. A high fee that decays does two things: the premium for being first is paid to the issuer and creator (80% of fees) rather than captured entirely by the fastest bot, and by the time the fee reaches the steady rate, price discovery has already happened. It is the on-chain analogue of an exchange opening auction.

Exponential decay means the fee drops quickly at first and flattens out: with the default, it is about 11% after 15 minutes, 5% after 30, 2.2% after 45 and 1% at 60 (each step multiplies the fee by the same factor, (1/25)^(1/120) per 30-second step).

## Why the volatility fee

DBC's dynamic fee adds a variable component when the price moves a lot within a short window. For an asset quoted in a stock it behaves like a circuit breaker: violent moves cost more, calm trading costs the base fee.

## Graduation in USD

DBC measures graduation in quote tokens. People think in dollars, and a stock's price moves. So:

```
threshold (stock) = ceil_2dp( graduationUsd / (stockUsdPrice × scaledUiMultiplier) )
```

- The price comes from Jupiter's price API at the moment you build the transaction.
- xStocks use the Token-2022 **scaled UI amount** extension: displayed balance = raw balance × multiplier (NVDAx ≈ 1.0017 today). Prices are quoted per displayed unit, so the multiplier is applied.
- Rounded **up** to 2 decimals so the threshold never lands below the dollar target.
- Meteora's migration keeper only migrates stock-quoted pools whose threshold is worth **at least $750**, so lower values are refused. $1,000 default leaves headroom if the stock falls.

When the reserve reaches the threshold, Meteora's keeper migrates: the stock reserve plus the paired share of supply become a DAMM v2 pool, and the LP position is split and locked as configured.

## The curve maths (what the preview computes)

`buildCurve` produces a starting sqrt price (Q64 fixed point) and up to 20 liquidity segments. Within a segment of liquidity `L`, moving from sqrt price `√Pa` to `√Pb` follows the standard concentrated-liquidity relations:

- stock paid in: `ΔQ ∝ L × (√Pb − √Pa)` (computed with the SDK's `getDeltaAmountQuoteUnsigned`)
- tokens bought out: `ΔB ∝ L × (1/√Pa − 1/√Pb)` (the SDK's `getDeltaAmountBaseUnsigned`)
- price at sqrt price s: `getPriceFromSqrtPrice(s, baseDecimals, quoteDecimals)`, i.e. `s² / 2^128 × 10^(baseDecimals − quoteDecimals)`

The preview walks the segments from the start price to the migration price (`getMigrationThresholdPrice`), sampling about 48 points, and reports the cumulative stock raised, tokens sold and price at each. The same functions compute "sold from curve" and the chart marker on a live pool. **The numbers in the preview are the program's own maths, not an approximation.**

### Worked example: default preset, NVDAx at $212

| Quantity | Value |
|---|---|
| Graduation threshold | $1,000 / ($212 × 1.0017) → **4.72 NVDAx** |
| Start price | 1.47 × 10⁻⁹ NVDAx per token |
| Opening market cap | 1B × start price × $212.7 ≈ **$313** |
| Graduation price | 2.36 × 10⁻⁸ NVDAx per token (16× the start) |
| Graduation market cap | ≈ **$5,000** |
| Sold on the curve | ≈ 800M tokens (80%) |
| Paired into DAMM v2 | ≈ 200M tokens + the 4.72 NVDAx reserve |

## Fees: who earns what

DBC takes **20%** of every trading fee for the protocol. The other 80% is split by `creatorTradingFeePercentage`:

| | Share of every fee (default) |
|---|---|
| Partner (config owner / fee claimer) | 40% |
| Creator (pool creator) | 40% |
| Meteora protocol | 20% |

When you launch through Stockcurve your wallet is both partner and creator, so **80% of all fees are yours**, paid in the stock, claimable from the pool page.

## Costs

| Action | Cost | Notes |
|---|---|---|
| Create config + pool | **0.0266 SOL** | Measured by simulation: config account, pool, two vaults, mint, Metaplex metadata, network fee. Not refundable |
| Priority fee | ~0.0001 SOL | 75th percentile of recent fees, capped |
| Trade | < 0.001 SOL | Plus the pool fee (in the quote) and Jupiter route fees |
| Claim fees | < 0.001 SOL | |

## Validation, in three layers

1. `checkSettings()` (client and server): plain-language checks (LP sums to 100%, ≥10% locked, ≥$750, fee ranges, window, supply).
2. The Meteora SDK's own `validateConfigParameters()` on the server, surfaced as "Meteora SDK: …".
3. A full mainnet simulation of the exact transaction before the wallet is asked to sign.
