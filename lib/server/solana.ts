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
