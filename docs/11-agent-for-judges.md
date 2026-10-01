# 11 · Agent API for judges

**For:** Superteam India / Colosseum. **Time:** a few minutes. **What it shows:** an agent launches a token, trades it, and earns fees **in the quote stock**, using HTTP only. No wallet UI.

The website and this API are the same server. The browser signs in Phantom; an agent signs with its own key. This walkthrough never broadcasts unless you opt in.

## One command

Terminal A:

```bash
npm run dev    # http://127.0.0.1:3120
```

Terminal B, from this repo (this branch, not the September production deploy):

```bash
STOCKCURVE_URL=http://127.0.0.1:3120 npm run agent:demo
```

That is a dry run. It prints seven steps and exits. It generates an ephemeral, unfunded payer and does not write a key. A launch simulation against that payer fails with “not enough SOL”. That is the point: the unsigned transaction is still in the response, and nothing was sent.

Optional flags: `--stock SPYx`, `--name "Chip Index"`, `--symbol CHIPS`, `--amount 0.01`. `DEMO_POOL` overrides the existing pool used for quote and claim (default: Jensen's Printer, `3vfyvEJRoyVKyDBwQTG7ekkvNLLyonrVBWQfHVtd14ZU`).

To actually land a launch (spends about **0.03 SOL** on mainnet):

```bash
KEYPAIR=keys/agent.json STOCKCURVE_SEND=1 STOCKCURVE_URL=http://127.0.0.1:3120 npm run agent:demo
```

`STOCKCURVE_SEND=1` broadcasts **only the launch**, and only when the simulation passed. It does not buy or claim. Single actions use `--send` instead:

```bash
KEYPAIR=keys/agent.json npm run agent -- launch --name "Chip Index" --symbol CHIPS --stock NVDAx --send
KEYPAIR=keys/agent.json npm run agent -- buy <pool> --pay SOL --amount 0.01 --send
KEYPAIR=keys/agent.json npm run agent -- claim <pool> --send
```

`KEYPAIR` is a `solana-keygen` JSON file. Without `--send` (and without `STOCKCURVE_SEND=1` on `demo`), every command stops after simulation.

## The lifecycle

Fees are collected in the quote token. Quote = NVDAx means the reserve and the trading fees are NVDAx. The launching wallet is both partner and creator, so it is owed **40% + 40% = 80%** of trading fees, paid in that stock. Meteora keeps the protocol 20%. Claiming moves the stock into the claimer's wallet. It does not pay out SOL.

| Step | Call | What a good response means |
|---|---|---|
| 1 | `GET /api/health` | `{ ok: true, slot }` — the API can see mainnet |
| 2 | `POST /api/preview` | `{ ok: true, warnings[], fees, startFdvUsd, graduationFdvUsd }` — settings the SDK will accept |
| 3 | `POST /api/metadata` then `POST /api/build` | An unsigned v0 transaction, the pool address, and `simulation` |
| 4 | Sign, then `POST /api/send` | `{ signature, accepted }` — at least one RPC took the signed bytes |
| 5 | `GET /api/pool/<pool>?wallet=` | Price, reserve, fee now, unclaimed stock fees, and `forWallet` |
| 6 | `POST /api/trade/quote` then `/api/trade/build` | A route and an unsigned swap. Quote has no `tx` |
| 7 | `POST /api/claim` | An unsigned claim of partner and/or creator fees, in the stock |

`BASE` below is `http://127.0.0.1:3120` or `https://stockcurve.pewcake.fun` once this branch is deployed. `warnings` and `forWallet` are on this branch. An older server still answers the same paths; it just omits those two fields.

### 1 · Health

```bash
curl -s "$BASE/api/health"
```

`{ "ok": true, "slot": <number> }`. `ok: false` or a connection error means `STOCKCURVE_URL` or `SOLANA_RPC` is wrong. Stop there.

### 2 · Preview (configure)

```bash
curl -s -X POST "$BASE/api/preview" -H 'content-type: application/json' \
  -d '{"stockMint":"Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"}'
```

That mint is NVDAx. Omitting other fields uses the desk defaults: 25% decaying to 1% over 60 minutes, $1,000 graduation, 80% of supply sold on the curve.

Read:

- `ok: true` — launch is allowed. `ok: false` plus `problems[]` blocks it (paused stock, no price, SDK rejection).
- `warnings[]` — equity risks, not hard failures. The website makes a human tick them. An agent should record them. Typical line: the issuer's permanent delegate can move the stock out of the pool.
- `fees.startBps` / `fees.endBps` / `fees.durationSec` — opening fee in basis points (2500 → 100 over 3600 seconds is 25% → 1%).
- `fees.partnerPct` / `creatorPct` / `protocolPct` — 40 / 40 / 20. The launcher is both partner and creator.
- `startFdvUsd`, `graduationFdvUsd`, `curve.graduationRaise` — market caps and how much of the stock must be raised. They move with the stock price. Do not hardcode them.
- `stock.paused`, `stock.permanentDelegate` — same risks, as data.

### 3 · Build the unsigned launch

```bash
curl -s -X POST "$BASE/api/metadata" -H 'content-type: application/json' \
  -d '{"name":"Agent Desk Demo","symbol":"AGENT","description":"Fees paid in the quote stock.","stock":"NVDAx"}'
```

`uri` is the permanent metadata link. It must be public `https`, at most **80 characters**, and not localhost. DBC metadata cannot be changed later. Locally, `publicBase` is the request origin, so the uri will be `http://127.0.0.1/...` and `/api/build` will refuse it. Set `PUBLIC_BASE_URL=https://stockcurve.pewcake.fun` (or your public origin) on the server. The demo script, when it sees a localhost uri, substitutes a known public example so the simulation can still be built, and says so. `npm run agent -- launch` does not substitute: it stops and tells you to set `PUBLIC_BASE_URL`.

Generate two keypairs (config and mint). Send only their public keys:

```bash
curl -s -X POST "$BASE/api/build" -H 'content-type: application/json' -d '{
  "settings": {"stockMint":"Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"},
  "wallet": "<payer pubkey>",
  "config": "<config pubkey>",
  "baseMint": "<mint pubkey>",
  "name": "Agent Desk Demo",
  "symbol": "AGENT",
  "uri": "<https uri, ≤80 chars>"
}'
```

HTTP 200:

- `tx` — base64 versioned transaction, **unsigned**. Under 1232 bytes.
- `pool` — the DBC address this transaction will create.
- `lastValidBlockHeight` — from the blockhash baked in at build time. Do not rely on it after a human delay; refresh before signing (step 4).
- `simulation.ok` — the server simulated with signature checks off and a fresh blockhash. `true` means these accounts would succeed.
- `simulation.units` — compute units consumed.
- `simulation.error` — when `ok` is false. “Not enough SOL for rent and fees (about 0.03 SOL needed).” is expected for an unfunded payer. The `tx` is still returned.
- `simulation.logs` — last program logs, only when it failed.

The payer becomes `feeClaimer` and pool creator.

### 4 · Sign and send

Not done by the dry run.

1. Deserialize `tx`. Replace `recentBlockhash` with `getLatestBlockhash` through `POST /api/rpc` (method allow-list). The build-time blockhash expires while you read the output.
2. Sign with the **payer**, the **config** keypair, and the **mint** keypair. A trade or a claim is signed by the payer only.
3. `POST /api/send` with `{ "tx": "<signed base64>" }`.
   - HTTP 200 `{ signature, accepted }` — at least one RPC accepted it. `accepted` is how many.
   - HTTP 502 `{ error, signature }` — every RPC rejected it. `signature` is only the transaction id. Do not poll it as if it were in flight.
   - HTTP 400 `transaction is not signed` — the payer signature is missing.
4. Poll `getSignatureStatuses` through `/api/rpc` until `confirmed`. Then `POST /api/pools/track` with `{ "pool": "<address>" }` so the index shows it immediately.

`scripts/agent.ts` does steps 1–4 when you pass `--send` or `STOCKCURVE_SEND=1`.

### 5 · Pool status, including what this wallet can claim

```bash
curl -s "$BASE/api/pool/3vfyvEJRoyVKyDBwQTG7ekkvNLLyonrVBWQfHVtd14ZU?wallet=<payer>"
```

- `stock.symbol` — the quote. Fees and the reserve are this token.
- `priceUsd`, `fdvUsd`, `quoteReserve`, `progressPct`, `feeNowBps`, `isMigrated`.
- `unclaimed.partner`, `unclaimed.creator`, `unclaimed.protocol` — stock amounts still sitting in the pool. Protocol is Meteora's.
- `feeClaimer`, `creator` — who may claim.
- `forWallet` (only when `?wallet=` is set): `isFeeClaimer`, `isCreator`, `claimable` (stock units), `claimableUsd`, `paidIn`, `sharePct`, and a one-line `note`. A stranger gets `claimable: 0` and `sharePct: 0`. The launcher gets 80 and the sum of partner + creator unclaimed fees.
- `?fresh=1` drops the 4-second snapshot cache. Use it right after a trade or a claim.

A bad `wallet` is HTTP 400 `wallet is not a Solana address.` A bad pool is 404 `No DBC pool at this address.`

### 6 · Quote, then build a trade

```bash
curl -s -X POST "$BASE/api/trade/quote" -H 'content-type: application/json' -d '{
  "pool": "3vfyvEJRoyVKyDBwQTG7ekkvNLLyonrVBWQfHVtd14ZU",
  "side": "buy", "asset": "SOL", "amount": "0.01", "slippageBps": 300, "route": "auto"
}'
```

`route` is `jupiter` or `dbc`. `routeLabel` is the sentence to show. `inAmount` / `outAmount` / `minOut` are human amounts. `priceImpactPct` is set on Jupiter quotes. There is no transaction in this response. The pool token is labeled `token` here; its ticker is `token.symbol` on the pool snapshot (`PRINT` for the example pool). The demo prints that ticker.

If Jupiter has no route yet (common on a brand-new pool), the error says so. Repeat with `"route": "dbc"` and `"asset": "STOCK"`. The buyer must already hold the stock.

```bash
curl -s -X POST "$BASE/api/trade/build" -H 'content-type: application/json' -d '{
  "pool": "3vfyvEJRoyVKyDBwQTG7ekkvNLLyonrVBWQfHVtd14ZU",
  "side": "buy", "asset": "SOL", "amount": "0.01", "slippageBps": 300,
  "route": "auto", "wallet": "<payer>"
}'
```

Same quote fields, plus `tx`, `lastValidBlockHeight`, and `simulation` (`ok`, `units`, `error`, `logs`). An unfunded payer gets `simulation.ok: false` and “Not enough balance…”. Sign with the payer only, then `/api/send`.

`sell` is the same with `"side": "sell"`. `--direct` on the CLI forces `route: "dbc"`.

### 7 · Claim fees in the stock

```bash
curl -s -X POST "$BASE/api/claim" -H 'content-type: application/json' \
  -d '{"pool":"3vfyvEJRoyVKyDBwQTG7ekkvNLLyonrVBWQfHVtd14ZU","wallet":"<payer>"}'
```

- HTTP 400 `Only the pool's fee claimer or creator can claim its trading fees.` — this wallet is neither. Expected for the ephemeral demo payer.
- HTTP 400 `Nothing to claim yet.` — the wallet is allowed, and partner and creator unclaimed fees are zero (already claimed, or no trade has paid a fee). Protocol fees are not claimable here. Jensen's Printer is in this state: the September launch already claimed.
- HTTP 200 `{ tx, claims, lastValidBlockHeight, simulation }` — `claims` looks like `["partner: 0.01 NVDAx", "creator: 0.01 NVDAx"]`. The unsigned transaction withdraws that stock to the claimer. Simulation uses signature checks off, so you can build it for the fee-claimer pubkey without their secret. Sending it still requires their signature.

After a confirmed claim, `GET /api/pool/<pool>?wallet=<claimer>&fresh=1` shows `forWallet.claimable` at 0. The protocol line stays.

## Env limits

| Limit | What it means for this demo |
|---|---|
| No `SOLANA_RPC` in the environment | The server uses the public mainnet RPC (`https://api.mainnet-beta.solana.com`). It rate-limits. A Helius URL in `SOLANA_RPC` is what production uses. |
| No funded key in CI | Dry run is the default. Do not set `STOCKCURVE_SEND=1` unless you intend to spend SOL. |
| `PUBLIC_BASE_URL` unset locally | `/api/metadata` returns a localhost uri. `/api/build` refuses it. The demo substitutes a public example uri and says so. A real `launch` does not. |
| Jupiter lite API | Quote and the SOL path need it. If it is down, use a direct stock swap (`route: "dbc"`, `asset: "STOCK"`). |
| Live site | https://stockcurve.pewcake.fun serves the last deploy. `warnings` and `?wallet=` / `forWallet` show up there after this branch is deployed. Point `STOCKCURVE_URL` at `npm run dev` to see them now. |
| `bigint` native binding warning | Harmless fallback during `next build`. Documented in [05-operations.md](05-operations.md). |

Full endpoint table: [03-architecture.md](03-architecture.md#api-reference). CLI flags and the Clawpump note: [09-agent-api.md](09-agent-api.md). Click-through demo: [10-hackathon-demo.md](10-hackathon-demo.md).
