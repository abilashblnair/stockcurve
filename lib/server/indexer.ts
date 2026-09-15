import "server-only";
import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID, getPriceFromSqrtPrice } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { STOCKS } from "../stocks.ts";
import { connection, dbc } from "./solana.ts";

// Every DBC pool quoted in a supported stock. getProgramAccounts cannot OR
// filters, so the scan is: configs per stock (quote_mint at offset 8), then
// pools per config (config at offset 72). A full pass is a few hundred RPC
// calls, paced, run in the background and persisted to disk.

export type IndexedPool = {
  address: string;
  baseMint: string;
  config: string;
  creator: string;
  stock: string; // symbol
  name: string;
  symbol: string;
  quoteReserve: number; // stock
  threshold: number; // stock
  progressPct: number;
  price: number; // stock per token
  isMigrated: boolean;
  launchedHere?: boolean; // metadata hosted by this Stockcurve deployment
};

export type PoolIndex = { pools: IndexedPool[]; updatedAt: number | null; scanning: boolean; progress: string };

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "pool-index.json");
// Gentle on the shared RPC key: one full pass every 30 minutes, about 3 calls a second.
const REFRESH_MS = 30 * 60_000;
const PACE_MS = 320;
const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const g = globalThis as unknown as { __scIndex?: PoolIndex & { started: boolean } };
if (!g.__scIndex) {
  let pools: IndexedPool[] = [];
  let updatedAt: number | null = null;
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    pools = j.pools ?? [];
    updatedAt = j.updatedAt ?? null;
  } catch {
    /* first run */
  }
  g.__scIndex = { pools, updatedAt, scanning: false, progress: "", started: false };
}
const idx = g.__scIndex;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const n = (v: any) => Number(v?.toString?.() ?? 0);

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
}

function readName(data: Buffer): { name: string; symbol: string; launchedHere: boolean } {
  try {
    const str = (o: number): [string, number] => {
      const l = data.readUInt32LE(o);
      return [data.subarray(o + 4, o + 4 + l).toString("utf8").replace(/\0+$/, "").trim(), o + 4 + l];
    };
    let o = 1 + 32 + 32;
    let name: string, symbol: string, uri: string;
    [name, o] = str(o);
    [symbol, o] = str(o);
    [uri] = str(o);
    // Metadata hosted by this deployment means the pool was launched here.
    const base = process.env.PUBLIC_BASE_URL;
    return { name, symbol, launchedHere: !!base && uri.startsWith(`${base}/meta/`) };
  } catch {
    return { name: "", symbol: "", launchedHere: false };
  }
}

async function scan() {
  if (idx.scanning) return;
  idx.scanning = true;
  const program = dbc.state.getProgram();
  const found: IndexedPool[] = [];
  try {
    for (const stock of STOCKS) {
      idx.progress = `configs for ${stock.symbol}`;
      const configs = await withRetry(() =>
        connection.getProgramAccounts(DYNAMIC_BONDING_CURVE_PROGRAM_ID, {
          filters: [{ dataSize: 1048 }, { memcmp: { offset: 8, bytes: stock.mint } }],
        }),
      );
      await sleep(PACE_MS);
      let i = 0;
      for (const c of configs) {
        i++;
        idx.progress = `${stock.symbol} config ${i}/${configs.length}`;
        let cfg: any;
        try {
          cfg = program.coder.accounts.decode("poolConfig", c.account.data);
        } catch {
          continue;
        }
        const pools = await withRetry(() => dbc.state.getPoolsByConfig(c.pubkey)).catch(() => [] as any[]);
        for (const p of pools as any[]) {
          const s = p.account?.poolState ?? p.account;
          if (!s?.baseMint) continue;
          const reserve = n(s.quoteReserve) / 10 ** stock.decimals;
          const threshold = n(cfg.migrationQuoteThreshold) / 10 ** stock.decimals;
          found.push({
            address: p.publicKey.toBase58(),
            baseMint: s.baseMint.toBase58(),
            config: c.pubkey.toBase58(),
            creator: s.creator.toBase58(),
            stock: stock.symbol,
            name: "",
            symbol: "",
            quoteReserve: reserve,
            threshold,
            progressPct: s.isMigrated ? 100 : threshold ? Math.min(100, (reserve / threshold) * 100) : 0,
            price: Number(getPriceFromSqrtPrice(s.sqrtPrice, cfg.tokenDecimal, stock.decimals).toString()),
            isMigrated: !!s.isMigrated,
          });
        }
        await sleep(PACE_MS);
      }
    }

    // Names from Metaplex metadata, 100 accounts per call.
    idx.progress = "token names";
    for (let k = 0; k < found.length; k += 100) {
      const batch = found.slice(k, k + 100);
      const pdas = batch.map(
        (p) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX.toBuffer(), new PublicKey(p.baseMint).toBuffer()], METAPLEX)[0],
      );
      const accts = await withRetry(() => connection.getMultipleAccountsInfo(pdas)).catch(() => []);
      accts.forEach((a, j) => {
        if (a) Object.assign(batch[j], readName(a.data));
      });
      await sleep(PACE_MS);
    }

    // Keep pools tracked while the scan ran (launched after their config was scanned).
    const seen = new Set(found.map((p) => p.address));
    idx.pools = [...found, ...idx.pools.filter((p) => !seen.has(p.address) && STOCKS.some((x) => x.symbol === p.stock))];
    idx.updatedAt = Date.now();
    persist();
  } catch (e) {
    idx.progress = `last scan failed: ${e instanceof Error ? e.message : e}`;
  } finally {
    idx.scanning = false;
    if (!idx.progress.startsWith("last scan failed")) idx.progress = "";
  }
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ updatedAt: idx.updatedAt, pools: idx.pools }));
}

/** Add or refresh one pool right away (called after a launch), so it shows without waiting for a scan. */
export async function trackPool(address: string): Promise<IndexedPool | null> {
  const key = new PublicKey(address);
  const w: any = await withRetry(() => dbc.state.getPool(key), 6);
  const s = w?.poolState ?? w;
  if (!s?.config) return null;
  const cfg: any = await withRetry(() => dbc.state.getPoolConfig(s.config));
  const stock = STOCKS.find((x) => cfg && x.mint === cfg.quoteMint.toBase58());
  if (!stock) return null;
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX.toBuffer(), s.baseMint.toBuffer()], METAPLEX);
  const meta = await connection.getAccountInfo(pda).catch(() => null);
  const reserve = n(s.quoteReserve) / 10 ** stock.decimals;
  const threshold = n(cfg.migrationQuoteThreshold) / 10 ** stock.decimals;
  const entry: IndexedPool = {
    address,
    baseMint: s.baseMint.toBase58(),
    config: s.config.toBase58(),
    creator: s.creator.toBase58(),
    stock: stock.symbol,
    ...(meta ? readName(meta.data) : { name: "", symbol: "", launchedHere: false }),
    quoteReserve: reserve,
    threshold,
    progressPct: s.isMigrated ? 100 : threshold ? Math.min(100, (reserve / threshold) * 100) : 0,
    price: Number(getPriceFromSqrtPrice(s.sqrtPrice, cfg.tokenDecimal, stock.decimals).toString()),
    isMigrated: !!s.isMigrated,
  };
  idx.pools = [entry, ...idx.pools.filter((p) => p.address !== address)];
  persist();
  return entry;
}

/** Current index; kicks off a background scan when stale. Never blocks on the scan. */
export function poolIndex(): PoolIndex {
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const stale = !idx.updatedAt || Date.now() - idx.updatedAt > REFRESH_MS;
    if (stale && !idx.scanning) void scan();
    if (!idx.started) {
      idx.started = true;
      setInterval(() => void scan(), REFRESH_MS).unref?.();
    }
  }
  return { pools: idx.pools, updatedAt: idx.updatedAt, scanning: idx.scanning, progress: idx.progress };
}
