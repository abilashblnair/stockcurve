import "server-only";
import fs from "node:fs";
import path from "node:path";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { DYNAMIC_BONDING_CURVE_PROGRAM_ID, getPriceFromSqrtPrice } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { STOCKS } from "../stocks.ts";
import { feeBpsAt, feeSummary, type FeeModel } from "./curve.ts";
import { connection, dbc } from "./solana.ts";

// Every DBC pool quoted in a supported stock. getProgramAccounts cannot OR
// filters, so the scan is: configs per stock (quote_mint at offset 8), then
// pools per config (config at offset 72). A full pass is a few hundred RPC
// calls, paced, run in the background and persisted to disk.
// Pools are published after each stock so a cold page is not blank for the whole pass.

export type FeeSchedule = FeeModel["schedule"];

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
  /** Base fee in force. Refreshed for timestamp pools when the index is served. */
  feeNowBps?: number;
  feeStartBps?: number;
  feeEndBps?: number;
  /** Wall-clock length of a decaying schedule. 0 is flat or a rate limiter. */
  feeDurationSec?: number;
  feeSchedule?: FeeSchedule;
  /** Inputs for feeNowBps. Kept on disk; stripped from the API response. */
  feeActivation?: {
    point: number;
    timestamp: boolean;
    cliff: string;
    periods: number;
    freq: string;
    third: string;
    mode: number;
  };
};

export type PoolIndex = {
  pools: IndexedPool[];
  updatedAt: number | null;
  scanning: boolean;
  progress: string;
  /** Set when the last pass stopped early. Pools found before that are still listed. */
  error: string | null;
};

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), ".data");
const FILE = path.join(DATA_DIR, "pool-index.json");
// Gentle on the shared RPC key: one full pass every 30 minutes, about 3 calls a second.
const REFRESH_MS = 30 * 60_000;
const PACE_MS = 320;
const RPC_TIMEOUT_MS = 20_000;
const HUNG_MS = 120_000;
const METAPLEX = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
// Metadata hosted by this deployment, plus the public site, so a local server
// without PUBLIC_BASE_URL still recognises pools launched on the desk.
const KNOWN_META_HOSTS = ["stockcurve.pewcake.fun"];

type Runtime = PoolIndex & { started: boolean; heartbeat: number; retryAfter: number };
const g = globalThis as unknown as { __scIndex?: Runtime; __scScanGen?: number };
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
  g.__scIndex = { pools, updatedAt, scanning: false, progress: "", error: null, started: false, heartbeat: 0, retryAfter: 0 };
}
g.__scIndex.error ??= null;
g.__scIndex.heartbeat ??= 0;
g.__scIndex.retryAfter ??= 0;
if (!g.__scScanGen) g.__scScanGen = 0;
const idx = g.__scIndex;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const n = (v: any) => Number(v?.toString?.() ?? 0);

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out. The RPC may be rate-limiting this index pass.`)), RPC_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1) throw e;
      await sleep(800 * (i + 1));
    }
  }
}

function metaHosts(): Set<string> {
  const hosts = new Set(KNOWN_META_HOSTS);
  const base = process.env.PUBLIC_BASE_URL;
  if (base) {
    try {
      hosts.add(new URL(base).host);
    } catch {
      /* ignore a bad PUBLIC_BASE_URL */
    }
  }
  return hosts;
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
    let launchedHere = false;
    try {
      const u = new URL(uri);
      launchedHere = u.pathname.startsWith("/meta/") && metaHosts().has(u.host);
    } catch {
      launchedHere = false;
    }
    return { name, symbol, launchedHere };
  } catch {
    return { name: "", symbol: "", launchedHere: false };
  }
}

function feeFields(cfg: any, state: any, nowSec: number, slot: number): Pick<IndexedPool, "feeNowBps" | "feeStartBps" | "feeEndBps" | "feeDurationSec" | "feeSchedule" | "feeActivation"> {
  const base = cfg?.poolFees?.baseFee;
  if (!base?.cliffFeeNumerator) return {};
  const timestamp = cfg.activationType === 1;
  const summary = feeSummary(base);
  const point = n(state.activationPoint);
  const nowPoint = timestamp ? nowSec : slot;
  const elapsed = Math.max(0, nowPoint - point);
  return {
    feeNowBps: timestamp || slot > 0 ? feeBpsAt(base, elapsed) : summary.startBps,
    feeStartBps: summary.startBps,
    feeEndBps: summary.endBps,
    feeDurationSec: timestamp ? summary.durationSec : summary.durationSec * 0.4,
    feeSchedule: summary.schedule,
    feeActivation: {
      point,
      timestamp: !!timestamp,
      cliff: base.cliffFeeNumerator.toString(),
      periods: Number(base.firstFactor ?? 0),
      freq: base.secondFactor?.toString?.() ?? "0",
      third: base.thirdFactor?.toString?.() ?? "0",
      mode: Number(base.baseFeeMode ?? 0),
    },
  };
}

function liveFeeBps(p: IndexedPool): number | undefined {
  const a = p.feeActivation;
  if (!a?.timestamp) return p.feeNowBps;
  try {
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - a.point);
    return feeBpsAt(
      {
        cliffFeeNumerator: new BN(a.cliff),
        firstFactor: a.periods,
        secondFactor: new BN(a.freq),
        thirdFactor: new BN(a.third),
        baseFeeMode: a.mode,
      },
      elapsed,
    );
  } catch {
    return p.feeNowBps;
  }
}

/** API shape: live fee, no fee-curve inputs. */
export function publicPool(p: IndexedPool): IndexedPool {
  const copy: IndexedPool = { ...p, feeNowBps: liveFeeBps(p) };
  delete copy.feeActivation;
  return copy;
}

function mergePools(found: IndexedPool[], baseline: IndexedPool[]): IndexedPool[] {
  const seen = new Set(found.map((p) => p.address));
  return [...found, ...baseline.filter((p) => !seen.has(p.address) && STOCKS.some((x) => x.symbol === p.stock))];
}

async function namePools(batch: IndexedPool[]) {
  for (let k = 0; k < batch.length; k += 100) {
    const slice = batch.slice(k, k + 100);
    const pdas = slice.map(
      (p) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), METAPLEX.toBuffer(), new PublicKey(p.baseMint).toBuffer()], METAPLEX)[0],
    );
    const accts = await withRetry(() => withTimeout(connection.getMultipleAccountsInfo(pdas), "token names")).catch(() => []);
    accts.forEach((a, j) => {
      if (a && slice[j]) Object.assign(slice[j], readName(a.data));
    });
    await sleep(PACE_MS);
  }
}

async function scan() {
  const hung = idx.scanning && Date.now() - idx.heartbeat > HUNG_MS;
  if (idx.scanning && !hung) return;
  const gen = (g.__scScanGen = (g.__scScanGen ?? 0) + 1);
  const alive = () => g.__scScanGen === gen;
  idx.scanning = true;
  idx.heartbeat = Date.now();
  idx.error = null;
  const program = dbc.state.getProgram();
  const baseline = idx.pools.slice();
  const found: IndexedPool[] = [];
  const beat = (progress: string) => {
    if (!alive()) return;
    idx.progress = progress;
    idx.heartbeat = Date.now();
  };
  const publish = () => {
    if (!alive()) return;
    idx.pools = mergePools(found, baseline);
    persist();
  };
  try {
    beat("starting");
    const nowSec = Math.floor(Date.now() / 1000);
    const slot = await withRetry(() => withTimeout(connection.getSlot("confirmed"), "slot")).catch(() => 0);
    for (const stock of STOCKS) {
      if (!alive()) return;
      beat(`configs for ${stock.symbol}`);
      const configs = await withRetry(() =>
        withTimeout(
          connection.getProgramAccounts(DYNAMIC_BONDING_CURVE_PROGRAM_ID, {
            filters: [{ dataSize: 1048 }, { memcmp: { offset: 8, bytes: stock.mint } }],
          }),
          `configs for ${stock.symbol}`,
        ),
      );
      await sleep(PACE_MS);
      const stockPools: IndexedPool[] = [];
      let i = 0;
      for (const c of configs) {
        if (!alive()) return;
        i++;
        beat(`${stock.symbol} config ${i}/${configs.length}`);
        let cfg: any;
        try {
          cfg = program.coder.accounts.decode("poolConfig", c.account.data);
        } catch {
          continue;
        }
        const pools = await withRetry(() => withTimeout(dbc.state.getPoolsByConfig(c.pubkey), `${stock.symbol} pools`)).catch(() => [] as any[]);
        for (const p of pools as any[]) {
          const s = p.account?.poolState ?? p.account;
          if (!s?.baseMint) continue;
          const reserve = n(s.quoteReserve) / 10 ** stock.decimals;
          const threshold = n(cfg.migrationQuoteThreshold) / 10 ** stock.decimals;
          stockPools.push({
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
            ...feeFields(cfg, s, nowSec, slot),
          });
        }
        await sleep(PACE_MS);
      }
      beat(`${stock.symbol} names`);
      await namePools(stockPools);
      found.push(...stockPools);
      publish();
    }

    if (!alive()) return;
    idx.pools = mergePools(found, baseline);
    idx.updatedAt = Date.now();
    idx.error = null;
    idx.retryAfter = 0;
    persist();
  } catch (e) {
    if (!alive()) return;
    if (found.length) publish();
    idx.error = e instanceof Error ? e.message : String(e);
    idx.retryAfter = Date.now() + 20_000;
    idx.progress = "";
  } finally {
    if (alive()) {
      idx.scanning = false;
      if (!idx.error) idx.progress = "";
    }
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
  const nowSec = Math.floor(Date.now() / 1000);
  const slot = cfg.activationType === 1 ? 0 : await connection.getSlot("confirmed").catch(() => 0);
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
    ...feeFields(cfg, s, nowSec, slot),
  };
  idx.pools = [entry, ...idx.pools.filter((p) => p.address !== address)];
  persist();
  return entry;
}

/** Current index; kicks off a background scan when stale. Never blocks on the scan. */
export function poolIndex(): PoolIndex {
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const stale = (!idx.updatedAt || Date.now() - idx.updatedAt > REFRESH_MS) && Date.now() >= idx.retryAfter;
    if (stale && !idx.scanning) void scan();
    else if (idx.scanning && Date.now() - idx.heartbeat > HUNG_MS) void scan();
    if (!idx.started) {
      idx.started = true;
      setInterval(() => void scan(), REFRESH_MS).unref?.();
    }
  }
  return {
    pools: idx.pools.map(publicPool),
    updatedAt: idx.updatedAt,
    scanning: idx.scanning,
    progress: idx.progress,
    error: idx.error,
  };
}
