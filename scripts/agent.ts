// Stockcurve for agents: everything the website does, over the public HTTP API,
// signed by the agent's own keypair. No SDK, no RPC key: the server builds and
// simulates, the agent signs, and sends through the server's /api/rpc proxy.
//
//   KEYPAIR=keys/agent.json npm run agent -- status <pool>
//   KEYPAIR=keys/agent.json npm run agent -- launch --name "Chip Index" --symbol CHIPS --description "..." [--image https://...] [--stock NVDAx]
//   KEYPAIR=keys/agent.json npm run agent -- buy <pool> --pay SOL --amount 0.01
//   KEYPAIR=keys/agent.json npm run agent -- sell <pool> --receive NVDAx --amount 100000
//   KEYPAIR=keys/agent.json npm run agent -- claim <pool>
//
// Every command is a DRY RUN (build + simulate) unless --send is given.
// STOCKCURVE_URL defaults to https://stockcurve.pewcake.fun.
import fs from "node:fs";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { STOCKS } from "../lib/stocks.ts";

const BASE = (process.env.STOCKCURVE_URL ?? "https://stockcurve.pewcake.fun").replace(/\/$/, "");
const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SEND = argv.includes("--send");

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = (await r.json()) as any;
  if (!r.ok || j?.error) throw new Error(`${path}: ${j?.error ?? r.status}`);
  return j as T;
}

function wallet(): Keypair {
  const p = process.env.KEYPAIR;
  if (!p) throw new Error("Set KEYPAIR to a solana-keygen JSON file for the agent's wallet.");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function signAndSend(b64: string, lastValidBlockHeight: number, signers: Keypair[]): Promise<string> {
  const conn = new Connection(`${BASE}/api/rpc`, "confirmed");
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  tx.sign(signers);
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  for (;;) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`failed on chain: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
    if ((await conn.getBlockHeight()) > lastValidBlockHeight) throw new Error("expired before confirmation; nothing was charged");
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function report(label: string, sim: { ok: boolean; error: string | null }) {
  console.log(`${label}: simulation ${sim.ok ? "OK" : `FAILED (${sim.error})`}`);
  if (!sim.ok) throw new Error("stopped: the transaction would fail");
  if (!SEND) console.log("dry run: add --send to sign and broadcast");
}

async function main() {
  if (cmd === "status") {
    if (!positional) throw new Error("usage: status <pool>");
    const s = await api(`/api/pool/${positional}`);
    console.log(JSON.stringify({
      token: `${s.token.name} (${s.token.symbol})`,
      quote: s.stock.symbol,
      priceUsd: s.priceUsd,
      marketCapUsd: s.fdvUsd,
      reserve: `${s.quoteReserve} ${s.stock.symbol} ($${s.quoteReserveUsd?.toFixed(2)})`,
      progressPct: s.progressPct,
      feeNowBps: s.feeNowBps,
      unclaimed: s.unclaimed,
      graduated: s.isMigrated,
      stockPaused: s.stock.paused,
    }, null, 2));
    return;
  }

  const kp = wallet();
  const me = kp.publicKey.toBase58();

  if (cmd === "launch") {
    const name = flag("name");
    const symbol = flag("symbol");
    if (!name || !symbol) throw new Error('usage: launch --name "Name" --symbol TICKER [--description ..] [--image https://..] [--stock NVDAx]');
    const stock = STOCKS.find((x) => x.symbol.toLowerCase() === (flag("stock") ?? "NVDAx").toLowerCase());
    if (!stock) throw new Error(`unknown stock; one of ${STOCKS.map((x) => x.symbol).join(", ")}`);
    const settings = { stockMint: stock.mint };
    const preview = await api("/api/preview", settings);
    if (!preview.ok) throw new Error(preview.problems.join("; "));
    console.log(`preview: opens at $${preview.startFdvUsd.toFixed(0)} market cap, graduates at $${preview.graduationFdvUsd.toFixed(0)} after raising ${preview.curve.graduationRaise} ${stock.symbol}`);
    const meta = await api("/api/metadata", { name, symbol, description: flag("description") ?? "", image: flag("image"), stock: stock.symbol });
    const config = Keypair.generate();
    const baseMint = Keypair.generate();
    const b = await api("/api/build", { settings, wallet: me, config: config.publicKey.toBase58(), baseMint: baseMint.publicKey.toBase58(), name, symbol, uri: meta.uri });
    report(`launch ${symbol}/${stock.symbol} pool ${b.pool}`, b.simulation);
    if (!SEND) return;
    const sig = await signAndSend(b.tx, b.lastValidBlockHeight, [kp, config, baseMint]);
    await api("/api/pools/track", { pool: b.pool }).catch(() => null);
    console.log(`launched: ${BASE}/pool/${b.pool}\ntx: https://solscan.io/tx/${sig}`);
    return;
  }

  if (cmd === "buy" || cmd === "sell") {
    if (!positional) throw new Error(`usage: ${cmd} <pool> --amount N [--pay|--receive SOL|USDC|<stock>] [--slippage-bps 300] [--direct]`);
    const assetFlag = (flag(cmd === "buy" ? "pay" : "receive") ?? "SOL").toUpperCase();
    const asset = assetFlag === "SOL" || assetFlag === "USDC" ? assetFlag : "STOCK";
    const req = { pool: positional, side: cmd, asset, amount: flag("amount") ?? "", slippageBps: Number(flag("slippage-bps") ?? 300), wallet: me, route: argv.includes("--direct") ? "dbc" : "auto" };
    const b = await api("/api/trade/build", req);
    console.log(`${cmd}: ${b.inAmount} ${b.inputSymbol} -> ~${b.outAmount} ${b.outputSymbol} (min ${b.minOut}) via ${b.routeLabel}`);
    report(cmd, b.simulation);
    if (!SEND) return;
    console.log(`tx: https://solscan.io/tx/${await signAndSend(b.tx, b.lastValidBlockHeight, [kp])}`);
    return;
  }

  if (cmd === "claim") {
    if (!positional) throw new Error("usage: claim <pool>");
    const b = await api("/api/claim", { pool: positional, wallet: me });
    console.log(`claim: ${b.claims.join(", ")}`);
    report("claim", b.simulation);
    if (!SEND) return;
    console.log(`tx: https://solscan.io/tx/${await signAndSend(b.tx, b.lastValidBlockHeight, [kp])}`);
    return;
  }

  console.log("commands: status <pool> | launch --name --symbol | buy <pool> --amount | sell <pool> --amount | claim <pool>   (add --send to broadcast)");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
