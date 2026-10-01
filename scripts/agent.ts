// Stockcurve for agents: everything the website does, over the public HTTP API,
// signed by the agent's own keypair. No SDK, no RPC key: the server builds and
// simulates, the agent signs, and broadcasts through /api/send.
//
//   npm run agent:demo
//   KEYPAIR=keys/agent.json npm run agent -- status <pool>
//   KEYPAIR=keys/agent.json npm run agent -- launch --name "Chip Index" --symbol CHIPS --description "..." [--image https://...] [--stock NVDAx]
//   KEYPAIR=keys/agent.json npm run agent -- buy <pool> --pay SOL --amount 0.01
//   KEYPAIR=keys/agent.json npm run agent -- sell <pool> --receive NVDAx --amount 100000
//   KEYPAIR=keys/agent.json npm run agent -- claim <pool>
//
// Every command is a DRY RUN (build + simulate) unless --send is given.
// `demo` never broadcasts unless STOCKCURVE_SEND=1 and KEYPAIR are both set.
// STOCKCURVE_URL defaults to https://stockcurve.pewcake.fun.
// DEMO_POOL overrides the existing pool the demo quotes and claims against.
import fs from "node:fs";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { STOCKS } from "../lib/stocks.ts";

const BASE = (process.env.STOCKCURVE_URL ?? "https://stockcurve.pewcake.fun").replace(/\/$/, "");
// Jensen's Printer, a real Stockcurve launch. Used so the trade and claim steps
// have a pool even when this process does not broadcast a new one.
const EXAMPLE_POOL = process.env.DEMO_POOL ?? "3vfyvEJRoyVKyDBwQTG7ekkvNLLyonrVBWQfHVtd14ZU";
// Public, immutable, and under the 80-character metadata cap. Stand-in only when
// this server would otherwise hand back a localhost URI (DBC metadata is permanent).
const PUBLIC_META_EXAMPLE = "https://stockcurve.pewcake.fun/meta/e909a5ec7d0c5e7965c18783";

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const SEND = argv.includes("--send");

type Sim = { ok?: boolean; units?: number | null; error?: string | null; logs?: string[] };

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = (await r.json()) as any;
  if (!r.ok || j?.error) throw new Error(`${path}: ${j?.error ?? r.status}`);
  return j as T;
}

async function call(path: string, body?: unknown): Promise<{ status: number; json: any }> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  } catch (e) {
    throw new Error(`Could not reach ${BASE}${path} (${e instanceof Error ? e.message : e}). Is STOCKCURVE_URL right?`);
  }
  const json = await r.json().catch(() => ({ error: `Response was not JSON (HTTP ${r.status}).` }));
  return { status: r.status, json };
}

function wallet(): Keypair {
  const p = process.env.KEYPAIR;
  if (!p) throw new Error("Set KEYPAIR to a solana-keygen JSON file for the agent's wallet.");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function loadWallet(): Keypair | null {
  if (!process.env.KEYPAIR) return null;
  return wallet();
}

async function broadcast(raw: Uint8Array): Promise<string> {
  const r = await fetch(`${BASE}/api/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx: Buffer.from(raw).toString("base64") }),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string; signature?: string };
  // A rejection still includes the transaction id. That is not an acceptance.
  if (!r.ok || !j.signature) throw new Error(j.error ?? "Could not broadcast the transaction.");
  return j.signature;
}

/**
 * Refresh the blockhash, sign, broadcast via /api/send, and poll until confirmed.
 * The blockhash from /api/build is not reused: wallet time would eat its validity window.
 */
async function signAndSend(b64: string, signers: Keypair[]): Promise<string> {
  const conn = new Connection(`${BASE}/api/rpc`, "confirmed");
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    ({ blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed"));
  } catch {
    throw new Error("Could not refresh the blockhash before signing.");
  }
  tx.message.recentBlockhash = blockhash;
  tx.sign(signers);
  const raw = tx.serialize();
  const sig = await broadcast(raw);
  const started = Date.now();
  let lastSend = Date.now();
  let height = 0;
  let lastHeightAt = 0;
  for (;;) {
    let st: { err?: unknown; confirmationStatus?: string } | null | undefined;
    try {
      st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
    } catch {
      st = null;
    }
    if (st?.err) throw new Error(`failed on chain: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
    if (Date.now() - lastHeightAt > 5000) {
      lastHeightAt = Date.now();
      try {
        height = await conn.getBlockHeight("confirmed");
      } catch {
        /* keep polling; the time cap still ends the wait */
      }
    }
    const expired = height > 0 && height > lastValidBlockHeight;
    if (expired || Date.now() - started > 90_000) {
      throw new Error(expired
        ? `The network did not include the transaction before it expired. Nothing was charged. Reference: ${sig}`
        : `Sent, but not confirmed yet. Check it before retrying. Reference: ${sig}`);
    }
    if (Date.now() - lastSend >= 2500) {
      lastSend = Date.now();
      broadcast(raw).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

function txBytes(b64: string | undefined): number | null {
  if (!b64) return null;
  try {
    return Buffer.from(b64, "base64").length;
  } catch {
    return null;
  }
}

function usableMetadataUri(uri: unknown): uri is string {
  return typeof uri === "string" && /^https:\/\/[^\s]+$/.test(uri) && uri.length <= 80 && !/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(uri);
}

function report(label: string, sim: Sim) {
  const units = sim.units ? `, ${sim.units} CU` : "";
  console.log(`${label}: simulation ${sim.ok ? `OK${units}` : `FAILED (${sim.error ?? "unknown"})`}`);
  if (!sim.ok) {
    if (/not enough/i.test(String(sim.error))) console.log("The unsigned transaction was still built. Fund the wallet (a launch is about 0.03 SOL) and run again.");
    throw new Error("stopped: the transaction would fail");
  }
  if (!SEND) console.log("dry run: add --send to sign and broadcast");
}

function section(n: string, title: string) {
  console.log(`\n${n}  ${title}`);
}

/** Short numbers for the terminal. Tiny values stay in scientific form so a reserve is not 16 digits. */
function fmt(n: unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "?";
  const abs = Math.abs(x);
  if (abs === 0) return "0";
  if (abs >= 1) return x.toLocaleString("en-US", { maximumFractionDigits: abs >= 100 ? 2 : 4 });
  return x.toExponential(2);
}

function explainSim(sim: Sim | undefined) {
  if (!sim) return "no simulation object";
  if (sim.ok) return `simulation OK${sim.units ? ` (${sim.units} compute units)` : ""}. The transaction would land if this wallet signed it. Nothing was sent.`;
  if (/not enough/i.test(String(sim.error))) return `simulation failed: ${sim.error} Expected when the payer has no SOL or no tokens. The unsigned transaction is still in the response. Nothing was sent.`;
  return `simulation failed: ${sim.error ?? "unknown"}. Nothing was sent.`;
}

async function demo() {
  console.log("Stockcurve agent lifecycle  (dry run)");
  console.log(`Server: ${BASE}`);
  console.log("An agent launches a token whose reserve and trading fees are a tokenized stock, then claims that stock. This command calls the same HTTP API as the website. It does not sign or broadcast unless KEYPAIR is set and STOCKCURVE_SEND=1.");

  const optIn = process.env.STOCKCURVE_SEND === "1";
  const kp = loadWallet();
  const payer = kp ?? Keypair.generate();
  if (!kp) {
    console.log(`Payer for this run: ${payer.publicKey.toBase58()} (ephemeral, not saved, unfunded). Set KEYPAIR to use a real wallet.`);
  } else {
    console.log(`Payer: ${payer.publicKey.toBase58()} (from KEYPAIR).`);
  }
  if (optIn && !kp) console.log("STOCKCURVE_SEND=1 is set, but there is no KEYPAIR, so this run still will not broadcast.");

  section("1/7", "Health");
  const health = await call("/api/health");
  if (!health.json?.ok) {
    console.log(`GET /api/health → HTTP ${health.status} ${health.json?.error ?? ""}`);
    throw new Error("The server is not ready. Fix STOCKCURVE_URL or SOLANA_RPC and run again.");
  }
  console.log(`GET /api/health → { ok: true, slot: ${health.json.slot} }. The API can see mainnet.`);

  section("2/7", "Configure and preview");
  const stockSymbol = (flag("stock") ?? "NVDAx");
  const stock = STOCKS.find((x) => x.symbol.toLowerCase() === stockSymbol.toLowerCase());
  if (!stock) throw new Error(`unknown stock; one of ${STOCKS.map((x) => x.symbol).join(", ")}`);
  const preview = await call("/api/preview", { stockMint: stock.mint });
  const p = preview.json;
  if (!preview.status || p?.error) throw new Error(p?.error ?? "preview failed");
  if (!p.ok) {
    console.log(`POST /api/preview → ok: false. Problems: ${(p.problems ?? []).join("; ") || "unknown"}`);
    console.log("Launch stays blocked until those are fixed. Continuing with an existing pool so quote and claim still run.");
  } else {
    const fee = p.fees ?? {};
    console.log(`POST /api/preview { stockMint: ${stock.symbol} } → ok: true`);
    console.log(`  Opens near $${Math.round(p.startFdvUsd)} market cap, graduates near $${Math.round(p.graduationFdvUsd)} after raising ${p.curve?.graduationRaise} ${stock.symbol}.`);
    console.log(`  Fee: ${fee.startBps} bps → ${fee.endBps} bps over ${fee.durationSec}s. Split: partner ${fee.partnerPct}% / creator ${fee.creatorPct}% / Meteora ${fee.protocolPct}%, paid in ${stock.symbol}.`);
    console.log("  The agent that launches is both partner and creator, so 80% of trading fees are its income, in the stock, not in SOL.");
    const warnings: string[] = Array.isArray(p.warnings) ? p.warnings : [];
    if (p.stock?.permanentDelegate && !warnings.length) warnings.push(`${stock.symbol} has a permanent delegate (${p.stock.permanentDelegate}). It can move the stock out of the pool.`);
    if (p.stock?.paused) warnings.push(`${stock.symbol} transfers are paused.`);
    if (warnings.length) {
      console.log("  Equity risks (the website asks a human to tick these; an agent should record them):");
      for (const w of warnings) console.log(`  - ${w}`);
    } else {
      console.log(`  No extra equity warnings on ${stock.symbol} right now. Still check stock.paused and stock.permanentDelegate on every preview.`);
    }
  }

  section("3/7", "Build the unsigned launch");
  let built: any = null;
  if (p?.ok) {
    const name = flag("name") ?? "Agent Desk Demo";
    const symbol = flag("symbol") ?? "AGENT";
    const meta = await call("/api/metadata", {
      name,
      symbol,
      description: flag("description") ?? "Dry-run agent launch. Fees and reserve are the quote stock.",
      stock: stock.symbol,
    });
    let uri = meta.json?.uri as string | undefined;
    console.log(`POST /api/metadata → HTTP ${meta.status} uri: ${uri ?? meta.json?.error}`);
    if (!usableMetadataUri(uri)) {
      console.log(`  That uri cannot go on chain (DBC metadata is immutable and must be a public https URL of at most 80 characters). Using a stand-in so the simulation can still be built: ${PUBLIC_META_EXAMPLE}`);
      console.log("  A real launch should set PUBLIC_BASE_URL to the public origin and use the uri /api/metadata returned.");
      uri = PUBLIC_META_EXAMPLE;
    }
    const config = Keypair.generate();
    const baseMint = Keypair.generate();
    const builtCall = await call("/api/build", {
      settings: { stockMint: stock.mint },
      wallet: payer.publicKey.toBase58(),
      config: config.publicKey.toBase58(),
      baseMint: baseMint.publicKey.toBase58(),
      name,
      symbol,
      uri,
    });
    built = builtCall.json;
    if (builtCall.status >= 400 || built?.error) {
      console.log(`POST /api/build → HTTP ${builtCall.status} ${built?.error ?? ""}`);
    } else {
      console.log(`POST /api/build → HTTP 200, pool ${built.pool}, unsigned tx ${txBytes(built.tx)} bytes (limit 1232).`);
      console.log(`  ${explainSim(built.simulation)}`);
      console.log("  Response fields: tx (base64 v0, unsigned), pool, lastValidBlockHeight, simulation.ok / units / error / logs.");
      if (optIn && kp && built.simulation?.ok) {
        console.log("STOCKCURVE_SEND=1: signing and broadcasting this launch.");
        const sig = await signAndSend(built.tx, [kp, config, baseMint]);
        await api("/api/pools/track", { pool: built.pool }).catch(() => null);
        console.log(`  launched: ${BASE}/pool/${built.pool}`);
        console.log(`  tx: https://solscan.io/tx/${sig}`);
      }
    }
  }

  section("4/7", "How signing and send work (not done in a dry run)");
  console.log("When you mean to land it:");
  console.log("  1. Deserialize `tx`. Replace recentBlockhash with getLatestBlockhash from POST /api/rpc, so approval time does not eat the validity window.");
  console.log("  2. Sign with the payer, plus the config and mint keypairs generated for this launch. A trade or claim is signed by the payer only.");
  console.log("  3. POST /api/send { tx: <signed base64> }. HTTP 200 { signature, accepted } means at least one RPC took it. A 502 that still includes signature was rejected; do not poll it.");
  console.log("  4. Poll getSignatureStatuses through /api/rpc until confirmed. Then POST /api/pools/track { pool } so the index shows it immediately.");
  console.log("  Opt in for this script: KEYPAIR=keys/agent.json STOCKCURVE_SEND=1 npm run agent:demo");
  console.log("  Or one action at a time: npm run agent -- launch --name ... --symbol ... --send");

  section("5/7", "Status of a live stock-quoted pool");
  const status = await call(`/api/pool/${EXAMPLE_POOL}?wallet=${payer.publicKey.toBase58()}`);
  const s = status.json;
  if (status.status >= 400 || s?.error) {
    console.log(`GET /api/pool/${EXAMPLE_POOL} → HTTP ${status.status} ${s?.error ?? ""}`);
  } else {
    const yours = (s.fees?.partnerPct ?? 0) + (s.fees?.creatorPct ?? 0);
    console.log(`GET /api/pool/<address> → ${s.token?.name} (${s.token?.symbol}) quoted in ${s.stock?.symbol}.`);
    console.log(`  Price $${fmt(s.priceUsd)}, market cap $${s.fdvUsd == null ? "?" : Math.round(s.fdvUsd)}, reserve ${fmt(s.quoteReserve)} ${s.stock?.symbol}, progress ${Number(s.progressPct).toFixed(4)}%, fee now ${s.feeNowBps} bps, graduated: ${s.isMigrated}.`);
    console.log(`  Unclaimed quote fees: partner ${fmt(s.unclaimed?.partner)}, creator ${fmt(s.unclaimed?.creator)}, protocol ${fmt(s.unclaimed?.protocol)} ${s.stock?.symbol}.`);
    console.log(`  A launcher who is both partner and creator is owed about ${yours}% of trading fees, paid in ${s.stock?.symbol}. Protocol stays with Meteora.`);
    if (s.forWallet) {
      console.log(`  forWallet (this payer): claimable ${fmt(s.forWallet.claimable)} ${s.forWallet.paidIn} (${s.forWallet.sharePct}%). ${s.forWallet.note}`);
    } else {
      console.log("  This server did not add forWallet. Read feeClaimer, creator, and unclaimed yourself, or run this version of the API.");
    }
    if (s.stock?.paused) console.log(`  ${s.stock.symbol} is paused: trades and claims that move it will fail until the issuer resumes.`);
    if (s.stock?.permanentDelegate) console.log(`  Permanent delegate: ${s.stock.permanentDelegate}`);
  }

  section("6/7", "Quote and build a buy");
  const amount = flag("amount") ?? "0.01";
  const quote = await call("/api/trade/quote", { pool: EXAMPLE_POOL, side: "buy", asset: "SOL", amount, slippageBps: 300, route: "auto" });
  if (quote.status >= 400 || quote.json?.error) {
    console.log(`POST /api/trade/quote → HTTP ${quote.status} ${quote.json?.error}`);
    console.log("  If Jupiter has no route yet, repeat with route: \"dbc\" and asset: \"STOCK\" (the buyer must hold the stock).");
  } else {
    const q = quote.json;
    const outName = q.outputSymbol === "token" && s?.token?.symbol ? s.token.symbol : q.outputSymbol;
    console.log(`POST /api/trade/quote buy ${amount} SOL → about ${fmt(q.outAmount)} ${outName} (min ${fmt(q.minOut)}) via ${q.routeLabel}.`);
    console.log("  Quote fields: route, routeLabel, inAmount, outAmount, minOut, priceImpactPct, inputSymbol, outputSymbol. No transaction yet.");
  }
  const trade = await call("/api/trade/build", { pool: EXAMPLE_POOL, side: "buy", asset: "SOL", amount, slippageBps: 300, route: "auto", wallet: payer.publicKey.toBase58() });
  if (trade.status >= 400 || trade.json?.error) {
    console.log(`POST /api/trade/build → HTTP ${trade.status} ${trade.json?.error}`);
  } else {
    console.log(`POST /api/trade/build → unsigned tx ${txBytes(trade.json.tx)} bytes. ${explainSim(trade.json.simulation)}`);
    console.log("  Same quote fields, plus tx, lastValidBlockHeight, and simulation. Sign with the payer only, then POST /api/send.");
  }

  section("7/7", "Claim fees in the stock");
  const stranger = await call("/api/claim", { pool: EXAMPLE_POOL, wallet: payer.publicKey.toBase58() });
  console.log(`POST /api/claim as this payer → HTTP ${stranger.status} ${stranger.json?.error ?? explainSim(stranger.json?.simulation)}`);
  if (s?.feeClaimer && s.feeClaimer !== payer.publicKey.toBase58()) {
    const owner = await call("/api/claim", { pool: EXAMPLE_POOL, wallet: s.feeClaimer });
    if (owner.json?.error) {
      console.log(`POST /api/claim as the fee claimer ${s.feeClaimer} → HTTP ${owner.status} ${owner.json.error}`);
      console.log("  Nothing to claim means partner and creator fees are already in that wallet (or no trade has paid a fee yet). Protocol fees are not claimable here.");
    } else {
      console.log(`POST /api/claim as the fee claimer → claims: ${(owner.json.claims ?? []).join(", ")}. ${explainSim(owner.json.simulation)}`);
      console.log("  This used the claimer's public key only, with signature checks off, so the response is an unsigned transaction. It was not signed and not sent.");
    }
  }
  console.log("  A successful claim response is { tx, claims: [\"partner: <amount> <stock>\", \"creator: ...\"], lastValidBlockHeight, simulation }. The stock arrives in the claimer's wallet.");

  console.log("\nDone. Dry run only: no transaction was broadcast unless you saw \"STOCKCURVE_SEND=1: signing\" above.");
  console.log("Curl-level detail: docs/11-agent-for-judges.md");
}

async function main() {
  if (cmd === "demo") {
    await demo();
    return;
  }

  if (cmd === "status") {
    if (!positional) throw new Error("usage: status <pool>");
    const walletQs = process.env.KEYPAIR ? `?wallet=${wallet().publicKey.toBase58()}` : "";
    const s = await api(`/api/pool/${positional}${walletQs}`);
    const yours = (s.fees?.partnerPct ?? 0) + (s.fees?.creatorPct ?? 0);
    console.log(JSON.stringify({
      token: `${s.token.name} (${s.token.symbol})`,
      quote: s.stock.symbol,
      priceUsd: s.priceUsd,
      marketCapUsd: s.fdvUsd,
      reserve: `${s.quoteReserve} ${s.stock.symbol} ($${s.quoteReserveUsd?.toFixed(2)})`,
      progressPct: s.progressPct,
      feeNowBps: s.feeNowBps,
      unclaimed: s.unclaimed,
      feeSplitPct: { partner: s.fees?.partnerPct, creator: s.fees?.creatorPct, protocol: s.fees?.protocolPct, launcherIfBoth: yours },
      paidIn: s.stock.symbol,
      forWallet: s.forWallet ?? null,
      graduated: s.isMigrated,
      stockPaused: s.stock.paused,
      permanentDelegate: s.stock.permanentDelegate,
    }, null, 2));
    return;
  }

  if (cmd !== "launch" && cmd !== "buy" && cmd !== "sell" && cmd !== "claim") {
    console.log("commands: demo | status <pool> | launch --name --symbol | buy <pool> --amount | sell <pool> --amount | claim <pool>");
    console.log("demo is a dry run. Other commands broadcast only with --send. See docs/11-agent-for-judges.md");
    if (cmd) process.exitCode = 1;
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
    if (preview.warnings?.length) {
      console.log("Equity risks on this stock:");
      for (const w of preview.warnings) console.log(`- ${w}`);
    }
    console.log(`preview: opens at $${preview.startFdvUsd.toFixed(0)} market cap, graduates at $${preview.graduationFdvUsd.toFixed(0)} after raising ${preview.curve.graduationRaise} ${stock.symbol}`);
    const meta = await api("/api/metadata", { name, symbol, description: flag("description") ?? "", image: flag("image"), stock: stock.symbol });
    if (!usableMetadataUri(meta.uri)) throw new Error(`Metadata uri is not a public https URL of at most 80 characters (${meta.uri}). Set PUBLIC_BASE_URL on the server.`);
    const config = Keypair.generate();
    const baseMint = Keypair.generate();
    const b = await api("/api/build", { settings, wallet: me, config: config.publicKey.toBase58(), baseMint: baseMint.publicKey.toBase58(), name, symbol, uri: meta.uri });
    report(`launch ${symbol}/${stock.symbol} pool ${b.pool}`, b.simulation);
    if (!SEND) return;
    const sig = await signAndSend(b.tx, [kp, config, baseMint]);
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
    console.log(`tx: https://solscan.io/tx/${await signAndSend(b.tx, [kp])}`);
    return;
  }

  if (cmd === "claim") {
    if (!positional) throw new Error("usage: claim <pool>");
    const b = await api("/api/claim", { pool: positional, wallet: me });
    console.log(`claim: ${b.claims.join(", ")}`);
    report("claim", b.simulation);
    if (!SEND) return;
    console.log(`tx: https://solscan.io/tx/${await signAndSend(b.tx, [kp])}`);
    return;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
