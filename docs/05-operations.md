# 05 · Operations

## Where it runs

| Item | Value |
|---|---|
| URL | https://stockcurve.pewcake.fun |
| Host | Oracle Always Free VM `68.233.111.231` (x86_64, 1 GB RAM + 2 GB swap), shared with pewcake.fun |
| DNS | GoDaddy, A record `stockcurve` → `68.233.111.231` |
| TLS | Let's Encrypt via Pewcake's Caddy (auto-renewing) |
| App | `~/stockcurve` compose project, service `stockcurve`, `node:20-alpine` running the Next.js standalone build read-only |
| Data | Docker volume `stockcurve_data` mounted at `/data`: `pool-index.json`, `meta/<sha>.json` |
| Limits | `mem_limit: 320m`, Node heap 220 MB |
| Network | joins `pewcake_default` with alias `stockcurve`; not published on the host |

Caddy block (lives in `sounding/deploy/Caddyfile`, Pewcake's repo, because Pewcake's deploy overwrites the server copy):

```
stockcurve.{$DOMAIN} {
  encode zstd gzip
  reverse_proxy stockcurve:3000
  header { X-Content-Type-Options nosniff; Referrer-Policy strict-origin-when-cross-origin; X-Frame-Options SAMEORIGIN }
}
http://stockcurve.{$DOMAIN} { redir https://stockcurve.{$DOMAIN}{uri} permanent }
```

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `SOLANA_RPC` | `~/stockcurve/.env.production` (copied from Pewcake on first deploy) | Helius RPC, server only |
| `PUBLIC_BASE_URL` | same | `https://stockcurve.pewcake.fun`; used for metadata links and for recognising pools launched here |
| `DATA_DIR` | compose | `/data` |
| `NEXT_DIST_DIR` | build only | `.next-dist` for release builds (OneDrive locks `.next`) |

Local development: `stockcurve/.env` with `SOLANA_RPC`, then `npm run dev` (port 3120).

## Deploy

From the Windows PC, in Git Bash, in `stockcurve/`:

```bash
DIST_DIR="C:/Users/aiswarya/AppData/Local/Temp/stockcurve-dist" deploy/push.sh ubuntu@68.233.111.231 ../sounding/ssh/ssh-key-2026-09-05.key
```

What it does: `next build` (standalone) → assemble the release in `DIST_DIR` without `.env`, `.data`, `keys`, `runs` → upload with tar over ssh into `dist-new` → swap into `dist` (old kept as `dist-old`) → `docker compose up -d --force-recreate` → wait for `/api/health` → delete `dist-old` if healthy.

**Rollback** if the health check fails:

```bash
ssh -i ../sounding/ssh/ssh-key-2026-09-05.key ubuntu@68.233.111.231 'cd ~/stockcurve && rm -rf dist && mv dist-old dist && docker compose up -d --force-recreate'
```

## Checks

```bash
curl -s https://stockcurve.pewcake.fun/api/health
```

```bash
ssh -i ../sounding/ssh/ssh-key-2026-09-05.key ubuntu@68.233.111.231 'cd ~/stockcurve && docker compose ps && docker compose logs --tail 50 stockcurve && docker stats --no-stream'
```

## Known log noise (safe to ignore)

| Log line | Meaning |
|---|---|
| `bigint: Failed to load bindings, pure JS will be used` | Native bigint module not built for Alpine; the JS fallback is used. Harmless |
| `Server responded with 429 Too Many Requests. Retrying…` | Helius rate limit, usually during the 30-minute index scan. web3.js retries automatically. The indexer is paced to ~3 calls/s |
| `The Server Reference ID did not match the expected format. Received "x"` | Internet scanners probing for the React Server Actions vulnerability (CVE-2025-55182) with a fake action ID. Next.js 15.5.25 is patched and rejects them |

## Incidents and fixes (2026-09-15)

1. **Caddy config not updating.** Pewcake's compose bind-mounts `deploy/Caddyfile` as a single file. Pewcake's `push.sh` replaced it with `mv`, so the running Caddy kept reading the old, deleted file; `caddy reload` changed nothing. The running config was also missing Pewcake's `flush_interval -1`. Fixed by recreating the Caddy container once (about 2 s of downtime) and changing Pewcake's `push.sh` to write the file in place and reload Caddy. **That `push.sh` change is on the PC; it reaches the server with Pewcake's next deploy.**
2. **Slow pool pages and trades.** See [04-evidence.md](04-evidence.md#performance-live-server).
3. **A buy expired before landing** ("The network did not include the transaction before it expired"). Causes: Stockcurve-built transactions used a 10,000 micro-lamport floor because `getRecentPrioritizationFees` returns zeros on Helius; Jupiter swaps asked for `high`, which was only ~1,500 micro-lamports; the blockhash was fetched at build time so wallet-approval time counted against it; and signed bytes went to a single RPC. Fixed: Helius priority estimates, Jupiter `veryHigh` capped at 100,000 lamports, fresh blockhash right before signing, `/api/send` fan-out to two RPCs with re-sends every 2 s. `SEND_RPCS` (comma-separated) adds more broadcast endpoints.

## Costs

| Item | Cost |
|---|---|
| Server | Oracle Always Free |
| RPC | Shared Helius key with Pewcake. Consider a separate key before real traffic |
| Domain / TLS | Existing pewcake.fun domain, free certificates |
