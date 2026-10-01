# 09 · Agents (Clawpump track)

The Clawpump track asks for agents with access to traditional markets that **earn on RWAs**. Stockcurve's answer: an agent can launch a token whose reserve and trading fees are a tokenized stock, trade it, and claim its fees in that stock, using only HTTP and its own keypair.

## Why this fits

- **Fees in a stock.** DBC collects fees in the quote token. Quote = NVDAx means the agent's income is NVIDIA exposure, not a volatile memecoin.
- **No SDK, no RPC key.** The server builds and simulates; the agent only signs. Any agent runtime that can make HTTP calls and sign ed25519 can use it.
- **Safe by default.** Every command is a dry run unless `--send` is given, and every transaction is simulated before it is signed.

Judge walkthrough (one dry-run command, curl for each step, what the JSON means): [11-agent-for-judges.md](11-agent-for-judges.md).

```bash
STOCKCURVE_URL=http://127.0.0.1:3120 npm run agent:demo
```

That never broadcasts. `KEYPAIR` plus `STOCKCURVE_SEND=1` broadcasts the launch only, and only after simulation passes.

## CLI

```bash
KEYPAIR=keys/agent.json npm run agent -- status 3vfyvEJRoyVKyDBwQTG7ekkvNLLyonrVBWQfHVtd14ZU
```

```bash
KEYPAIR=keys/agent.json npm run agent -- launch --name "Agent Index" --symbol AGIDX --description "Run by an agent, priced in SPYx" --stock SPYx
```

```bash
KEYPAIR=keys/agent.json npm run agent -- buy <pool> --pay SOL --amount 0.01
```

```bash
KEYPAIR=keys/agent.json npm run agent -- claim <pool> --send
```

Commands: `demo`, `status`, `launch`, `buy`, `sell`, `claim`. Flags: `--send`, `--stock`, `--pay` / `--receive` (SOL, USDC or the stock symbol), `--amount`, `--slippage-bps`, `--direct` (skip Jupiter). `STOCKCURVE_URL` overrides the server. `demo` is dry-run unless `STOCKCURVE_SEND=1` and `KEYPAIR` are both set.

Verified against the live site on 2026-09-15: `status` returns the pool's price, reserve, progress, fee now and unclaimed fees; a dry-run `buy` from an unfunded wallet returns the Jupiter route and stops with "Not enough balance"; `claim` from a wallet that does not own the pool is refused.

## The HTTP flow an agent follows

1. `POST /api/preview` with settings → check `ok`, read `warnings` (permanent delegate and scheduled corporate actions)
2. `POST /api/metadata` → `uri` (public https, ≤ 80 characters; localhost is refused because DBC metadata is immutable)
3. Generate two keypairs (config, mint)
4. `POST /api/build` with the wallet and both public keys → `tx` (base64 v0, unsigned), `simulation` (`ok`, `units`, `error`, `logs`)
5. Replace the blockhash (`getLatestBlockhash` via `POST /api/rpc`), sign with wallet + config + mint, `POST /api/send`. HTTP 200 `{ signature, accepted }` means an RPC took it. A 502 that still includes `signature` was rejected.
6. `POST /api/pools/track` with the pool address
7. Later: `GET /api/pool/<pool>?wallet=<agent>` (`forWallet` is the claimable stock fees for that address), `POST /api/trade/quote` then `POST /api/trade/build` to trade, `POST /api/claim` to collect fees in the stock

Full endpoint list: [03-architecture.md](03-architecture.md#api-reference).

## Open question for Clawpump

The track requirement says "launch your token with a stock-paired liquidity pool using clawpump and Meteora". Clawpump's public docs (checked 2026-09-15) describe launches on pump.fun and on Pons (Robinhood Chain), not Meteora DBC. Before submitting, ask Clawpump whether:

- a Stockcurve-created DBC pool quoted in an xStock, launched by an agent, satisfies the requirement, or
- they expect the launch to go through a Clawpump endpoint (in which case Stockcurve's config builder can supply the DBC config for it).
