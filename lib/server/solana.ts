import "server-only";
import { Connection } from "@solana/web3.js";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";

const RPC = process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";

// One connection and one DBC client per server process.
const g = globalThis as unknown as { __sc?: { connection: Connection; dbc: DynamicBondingCurveClient } };
if (!g.__sc) {
  const connection = new Connection(RPC, { commitment: "confirmed", disableRetryOnRateLimit: false });
  g.__sc = { connection, dbc: DynamicBondingCurveClient.create(connection, "confirmed") };
}
export const connection = g.__sc.connection;
export const dbc = g.__sc.dbc;
export const RPC_URL = RPC;

/**
 * Compute-unit price (micro-lamports) for transactions we build.
 * getRecentPrioritizationFees returns all zeros on Helius, which left our
 * transactions at the floor and some expired before landing. Helius's own
 * estimator, scoped to the programs involved, gives a real "high" level.
 */
export async function priorityMicroLamports(accountKeys: string[]): Promise<number> {
  return cached(`prio:${[...accountKeys].sort().join(",")}`, 10_000, async () => {
    try {
      const r = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getPriorityFeeEstimate", params: [{ accountKeys, options: { includeAllPriorityFeeLevels: true } }] }),
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });
      const high = Number((await r.json())?.result?.priorityFeeLevels?.high);
      if (Number.isFinite(high) && high > 0) return Math.min(Math.max(Math.round(high * 1.2), 50_000), 2_000_000);
    } catch {
      /* not Helius, or slow: fall through */
    }
    const fees = await connection.getRecentPrioritizationFees().catch(() => []);
    const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
    const p90 = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 0;
    return Math.min(Math.max(p90, 100_000), 2_000_000);
  });
}

/** Small in-memory TTL cache with in-flight de-duplication. */
const store = new Map<string, { at: number; value?: unknown; pending?: Promise<unknown> }>();
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit?.value !== undefined && Date.now() - hit.at < ttlMs) return hit.value as T;
  if (hit?.pending) return hit.pending as Promise<T>;
  const pending = load()
    .then((value) => {
      store.set(key, { at: Date.now(), value });
      return value;
    })
    .catch((e) => {
      // Keep serving the last good value if there is one.
      if (hit?.value !== undefined) {
        store.set(key, { at: hit.at, value: hit.value });
        return hit.value as T;
      }
      store.delete(key);
      throw e;
    });
  store.set(key, { at: hit?.at ?? 0, value: hit?.value, pending });
  return pending;
}
