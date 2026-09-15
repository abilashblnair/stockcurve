import { VersionedTransaction, type Connection, type Keypair } from "@solana/web3.js";

type Signer = <T extends VersionedTransaction>(tx: T) => Promise<T>;

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function broadcast(raw: Uint8Array): Promise<string> {
  const r = await fetch("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: toBase64(raw) }) });
  const j = await r.json();
  if (!r.ok && !j.signature) throw new Error(j.error ?? "Could not broadcast the transaction.");
  if (!r.ok && /insufficient|0x1\b/i.test(String(j.error))) throw new Error("Not enough balance for this transaction.");
  return j.signature as string;
}

export type SendProgress = (stage: "signing" | "sending" | "confirming", seconds?: number) => void;

/**
 * Sign a server-built transaction and get it confirmed.
 *
 * 1. Swap in a fresh blockhash right before the wallet opens, so the ~60-90 s
 *    validity window is not spent on building. (Safe: nothing is signed yet;
 *    browser-generated signers sign after the swap.)
 * 2. Broadcast through the server to several RPCs, and re-send every 2 s.
 * 3. Poll status until confirmed or the blockhash expires.
 */
export async function signSendConfirm(
  connection: Connection,
  signTransaction: Signer,
  txBase64: string,
  _lastValidBlockHeight: number,
  extraSigners: Keypair[] = [],
  onProgress?: SendProgress,
): Promise<string> {
  const vtx = VersionedTransaction.deserialize(fromBase64(txBase64));
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  vtx.message.recentBlockhash = blockhash;
  if (extraSigners.length) vtx.sign(extraSigners);

  onProgress?.("signing");
  const signed = await signTransaction(vtx);
  const raw = signed.serialize();

  onProgress?.("sending");
  const signature = await broadcast(raw);
  const started = Date.now();
  let lastSend = Date.now();
  for (;;) {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s?.err) throw new Error("Transaction failed on chain: " + JSON.stringify(s.err));
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return signature;
    onProgress?.("confirming", Math.round((Date.now() - started) / 1000));
    if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      await new Promise((r) => setTimeout(r, 2000));
      const again = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (again && !again.err) return signature;
      throw new Error("The network did not include the transaction before it expired. Nothing was charged; please try again.");
    }
    if (Date.now() - lastSend >= 2000) {
      lastSend = Date.now();
      broadcast(raw).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

export const friendlyError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return "Cancelled in the wallet. Nothing was sent.";
  return msg;
};
