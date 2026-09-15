# Stockcurve

Configure, launch, trade and monitor Meteora Dynamic Bonding Curve pools whose quote token is a tokenized stock (xStocks: NVDAx, SPYx, AAPLx...).

**Live:** https://stockcurve.pewcake.fun · **Docs:** [docs/README.md](docs/README.md) (product, config maths, architecture, evidence, operations, FAQ, demo script, roadmap, agent API)

## App

| Route | What |
|---|---|
| `/create` | Config builder: quote stock, token, opening-auction fee schedule, USD graduation, LP lock and fee split. Live preview computed with the DBC SDK's own curve maths; one-click create (config + pool in one tx), simulated before the wallet opens |
| `/pool/[address]` | Pool monitor: price, market cap, reserve, progress, curve with position marker, fee in force now, fees earned, backing, decoded recent swaps, issuer controls of the quote stock (paused, permanent delegate, scaled UI multiplier) |
| `/pools` | Index of every DBC pool quoted in a supported stock, scanned from the program on mainnet and cached to `.data/` |
| `/how-it-works` | Why each setting exists |

Pool pages also have a buy/sell box (SOL, USDC or the stock; Jupiter first, direct curve fallback), a fee claim button for the pool owner, and a live price chart (GeckoTerminal / DexScreener / on-chain trades). `npm run agent` drives the same API from a keypair (see docs/09-agent-api.md).

API: `/api/stocks`, `/api/preview`, `/api/build`, `/api/metadata` (+ `/meta/[id]`), `/api/pool/[address]`, `/api/pools`, `/api/rpc` (allow-listed proxy so the RPC key stays server-side).

The DBC SDK runs only on the server (`lib/server/*`). The browser generates the config and mint keypairs, partially signs, and the wallet signs as payer.

```bash
npm install
npm run dev          # http://localhost:3120
```

Env: `SOLANA_RPC` (required), `PUBLIC_BASE_URL` (public origin for hosted token metadata; launches refuse localhost metadata links because DBC metadata is immutable), `DATA_DIR` (index + metadata storage, default `.data`), `NEXT_DIST_DIR` (build output; use `.next-verify` on OneDrive).

Launch transaction size is ~1190 of 1232 bytes with short strings, so custom metadata links are capped at 80 characters and oversized transactions are refused before simulation.

## Go/no-go (scripts/)

Can a Meteora Dynamic Bonding Curve launch use a tokenized stock (xStocks,
Token-2022) as its quote token, with an equity-tuned config, on mainnet?

## Scripts

| Stage | Command | Needs | Sends anything? |
|---|---|---|---|
| 1 probe | `npm run probe` (`-- --all` for every xStock) | RPC | no |
| 2 simulate | `npm run simulate -- NVDAx` | RPC | no (simulation, sig verify off) |
| 3 live | `KEYPAIR=keys/test-wallet.json npm run live -- NVDAx` | test wallet | dry run by default; `--send` broadcasts |

`.env` needs `SOLANA_RPC` (copied from sounding/.env.local). `keys/` and `runs/` are gitignored.

## Equity preset (lib/preset.ts)

- Quote token = the stock, so the curve reserve is equity and trading fees are paid in the stock
- Opening-auction fee: 25% decaying exponentially to 1% over the first hour, plus dynamic (volatility) fee
- Graduation threshold set in USD (default $1,000, keeper minimum $750), converted at build time
- Migrates to DAMM v2, 100% of LP permanently locked (50/50 partner/creator)
- SPL base token, 1B supply, 6 decimals, immutable metadata

## Results (2026-09-15)

Stage 1, read-only mainnet probe:
- NVDAx and SPYx are Token-2022 with PermanentDelegate, DefaultAccountState, ScaledUiAmount, Pausable, ConfidentialTransferMint, TransferHook (program unset), metadata
- Both have a DBC token badge (required for quote mints with those extensions)
- NVDAx: 173 DBC configs, 166 pools, 86 traded, 2 graduated to DAMM v2
- SPYx: 74 configs, 89 pools, 61 traded, 5 graduated

Stage 2, mainnet simulation:
- Our preset, config + pool in ONE tx: OK for NVDAx and SPYx (1149/1232 bytes, ~150k CU)
- Buy then sell in one tx on an existing bonding NVDAx pool and SPYx pool: OK (720 bytes, ~90k CU)

Stage 3: not run yet (needs a funded test wallet, ~0.05 SOL + 0.005 NVDAx).

## Things the product must handle

- **Scaled UI amount**: xStocks apply a multiplier for corporate actions (NVDAx 1.0017, SPYx 1.0057). DBC maths is on raw amounts; UI and USD values must apply the multiplier.
- **Pausable + permanent delegate**: the issuer can pause transfers or move tokens, which would freeze a curve. Show this on the pool page.
- **Eligibility**: xStocks are not offered to US persons.
- **Prior art**: hundreds of stock-quoted DBC pools already exist, so the originality has to come from the config (opening-auction fee, USD graduation, locked LP), tooling and monitoring, not from "stock as quote" alone.
