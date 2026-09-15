// Stage 1 of the go/no-go: read-only. No keypair, no transactions.
// For each tokenized stock: token program + extensions, whether DBC has a
// token badge for it (needed for Token-2022 quote mints with extra
// extensions), and what DBC pools on mainnet already use it as the quote
// token — have they traded, have any graduated to DAMM v2.
//
//   npm run probe              NVDAx + SPYx, every config scanned
//   npm run probe -- --all     every verified xStock, first 8 configs each
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  getExtensionTypes,
  getMint,
  getScaledUiAmountConfig,
  getTransferHook,
} from "@solana/spl-token";
import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveClient,
  deriveTokenBadgeAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

const RPC = process.env.SOLANA_RPC;
if (!RPC) throw new Error("SOLANA_RPC missing from .env");

const ALL = process.argv.includes("--all");
const CONFIGS_PER_STOCK = ALL ? 8 : Infinity;

type Stock = { symbol: string; mint: string };
const DEFAULT: Stock[] = [
  { symbol: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  { symbol: "SPYx", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
];

// PoolConfig: 8-byte discriminator then quote_mint; 1048 bytes total.
// TokenBadge also has the mint at offset 8, so the size filter matters.
const QUOTE_MINT_OFFSET = 8;
const POOL_CONFIG_SIZE = 1048;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function jupiterXStocks(): Promise<Stock[]> {
  try {
    const r = await fetch("https://lite-api.jup.ag/tokens/v2/search?query=xStock");
    const list = (await r.json()) as any[];
    return list
      .filter((t) => t.isVerified && /xStock$/.test(t.name ?? "") && t.id?.startsWith("Xs"))
      .map((t) => ({ symbol: t.symbol, mint: t.id }));
  } catch {
    return [];
  }
}

async function main() {
  const connection = new Connection(RPC!, "confirmed");
  const client = DynamicBondingCurveClient.create(connection, "confirmed");

  const seen = new Set<string>();
  const stocks = [...DEFAULT, ...(ALL ? await jupiterXStocks() : [])].filter(
    (s) => !seen.has(s.mint) && seen.add(s.mint),
  );

  console.log(`DBC program ${DYNAMIC_BONDING_CURVE_PROGRAM_ID.toBase58()}\n`);
  const verdicts: string[] = [];

  for (const s of stocks) {
    const mint = new PublicKey(s.mint);
    const info = await connection.getAccountInfo(mint);
    if (!info) {
      console.log(`${s.symbol}: mint not found\n`);
      continue;
    }
    const is2022 = info.owner.equals(TOKEN_2022_PROGRAM_ID);
    let extensions: string[] = [];
    let decimals = -1;
    let hook = "-";
    let multiplier = "-";
    if (is2022) {
      const m = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
      decimals = m.decimals;
      extensions = getExtensionTypes(m.tlvData).map((e) => ExtensionType[e]);
      const th = getTransferHook(m);
      hook = th ? (th.programId.equals(PublicKey.default) ? "unset" : th.programId.toBase58()) : "-";
      const sc = getScaledUiAmountConfig(m);
      if (sc) multiplier = `${sc.multiplier} (next ${sc.newMultiplier} at ${new Date(Number(sc.newMultiplierEffectiveTimestamp) * 1000).toISOString().slice(0, 10)})`;
    }

    const badge = await client.state.getTokenBadge(mint).catch(() => null);

    const configs = await connection.getProgramAccounts(DYNAMIC_BONDING_CURVE_PROGRAM_ID, {
      dataSlice: { offset: 0, length: 0 },
      filters: [{ dataSize: POOL_CONFIG_SIZE }, { memcmp: { offset: QUOTE_MINT_OFFSET, bytes: mint.toBase58() } }],
    });

    let pools = 0;
    let traded = 0;
    let migrated = 0;
    let best: { pool: string; quote: number; migrated: boolean } | null = null;
    const migratedExamples: string[] = [];
    for (const c of configs.slice(0, CONFIGS_PER_STOCK)) {
      const ps: any[] = await client.state.getPoolsByConfig(c.pubkey).catch(() => []);
      for (const p of ps) {
        const a = p.account?.poolState ?? p.account ?? p.poolState ?? p;
        if (!a?.quoteReserve) { console.log("  unexpected pool shape", Object.keys(p)); continue; }
        pools++;
        const quote = Number(a.quoteReserve.toString()) / 10 ** Math.max(decimals, 0);
        if (a.hasSwap || quote > 0) traded++;
        if (a.isMigrated) {
          migrated++;
          if (migratedExamples.length < 2) migratedExamples.push(p.publicKey.toBase58());
        }
        if (!best || quote > best.quote) best = { pool: p.publicKey.toBase58(), quote, migrated: !!a.isMigrated };
      }
      await sleep(150);
    }

    const scanned = Math.min(configs.length, CONFIGS_PER_STOCK);
    console.log(`${s.symbol}  ${s.mint}`);
    console.log(`  program      ${is2022 ? "Token-2022" : info.owner.toBase58()}  decimals ${decimals}`);
    console.log(`  extensions   ${extensions.join(", ") || "(none)"}`);
    console.log(`  transferHook ${hook}`);
    console.log(`  scaled UI    ${multiplier}`);
    console.log(`  token badge  ${badge ? "YES" : "no"}  (${deriveTokenBadgeAddress(mint).toBase58()})`);
    console.log(`  DBC configs quoted in ${s.symbol}: ${configs.length} (scanned ${scanned})`);
    console.log(`  pools ${pools} · traded ${traded} · graduated ${migrated}${migratedExamples.length ? `  e.g. ${migratedExamples.join(", ")}` : ""}`);
    if (best) console.log(`  deepest curve ${best.pool}  ${best.quote.toFixed(4)} ${s.symbol} in reserve${best.migrated ? " (graduated)" : ""}`);
    console.log();

    const go = !!badge && traded > 0;
    verdicts.push(`${s.symbol.padEnd(7)} ${go ? "GO   " : "CHECK"} badge=${badge ? "y" : "n"} traded=${traded} graduated=${migrated}`);
    await sleep(300);
  }

  console.log("Summary");
  for (const v of verdicts) console.log("  " + v);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
