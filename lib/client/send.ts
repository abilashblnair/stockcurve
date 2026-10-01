import { VersionedTransaction, type Connection, type Keypair } from "@solana/web3.js";

type Signer = <T extends VersionedTransaction>(tx: T) => Promise<T>;

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Chunked so a full-size transaction cannot blow the argument stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function explainChainErr(err: unknown): string {
  const raw = typeof err === "string" ? err : JSON.stringify(err);
  if (/insufficient/i.test(raw)) return "Not enough balance for this transaction.";
  if (/slippage|0x1771|0x177e|ExceededSlippage/i.test(raw)) return "Price moved past your slippage limit. Raise slippage or try a smaller amount.";
  if (/BlockhashNotFound|blockhash/i.test(raw)) return "The transaction expired before it landed. Nothing was charged. Try again.";
  return `The transaction failed on chain (${raw.slice(0, 160)}). If it did not confirm, nothing was charged.`;
}

async function broadcast(raw: Uint8Array): Promise<string> {
  let r: Response;
  try {
    r = await fetch("/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: toBase64(raw) }) });
  } catch {
    throw new Error("Could not reach Stockcurve to send the transaction. Try again.");
  }
  const j = (await r.json().catch(() => ({}))) as { error?: string; signature?: string };
  // A 502 still includes the signature (the tx id). That is not proof an RPC accepted it.
  if (!r.ok || !j.signature) {
    const err = String(j.error ?? "Could not broadcast the transaction.");
    if (/insufficient|0x1\b/i.test(err)) throw new Error("Not enough SOL for rent and network fees.");
    throw new Error(err);
  }
  return j.signature;
}

export type SendProgress = (stage: "signing" | "sending" | "confirming", seconds?: number) => void;

/**
 * Sign a server-built transaction and get it confirmed.
 *
 * 1. Swap in a fresh blockhash right before the wallet opens, so the ~60-90 s
 *    validity window is not spent on building. (Safe: nothing is signed yet;
 *    browser-generated signers sign after the swap.)
 * 2. Broadcast through the server to several RPCs, and re-send every 2 s.
 * 3. Poll status until confirmed or the blockhash expires. A blip from the
 *    RPC proxy does not abort a transaction that may already be in flight.
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
  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed"));
  } catch {
    throw new Error("Could not refresh the transaction before signing. Try again in a moment.");
  }
  vtx.message.recentBlockhash = blockhash;
  if (extraSigners.length) vtx.sign(extraSigners);

  onProgress?.("signing");
  const signed = await signTransaction(vtx);
  let raw: Uint8Array;
  try {
    raw = signed.serialize();
  } catch {
    throw new Error("The wallet did not return a signed transaction. Unlock it and try again.");
  }

  onProgress?.("sending");
  const signature = await broadcast(raw);
  const started = Date.now();
  let lastSend = Date.now();
  let lastHeightAt = 0;
  let height = 0;

  for (;;) {
    let status: { err: unknown; confirmationStatus?: string } | null | undefined;
    try {
      status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    } catch {
      status = null;
    }
    if (status?.err) throw new Error(explainChainErr(status.err));
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return signature;

    const sec = Math.round((Date.now() - started) / 1000);
    onProgress?.("confirming", sec);

    if (Date.now() - lastHeightAt > 5000) {
      lastHeightAt = Date.now();
      try {
        height = await connection.getBlockHeight("confirmed");
      } catch {
        /* keep the last height; the time cap still ends the wait */
      }
    }

    const expired = height > 0 && height > lastValidBlockHeight;
    const gaveUp = sec >= 90;
    if (expired || gaveUp) {
      await sleep(2000);
      try {
        const again = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
        if (again?.err) throw new Error(explainChainErr(again.err));
        if (again && (again.confirmationStatus === "confirmed" || again.confirmationStatus === "finalized")) return signature;
      } catch (e) {
        if (e instanceof Error && /failed on chain|slippage|Not enough balance|expired before it landed/.test(e.message)) throw e;
      }
      throw new Error(
        expired
          ? `The network did not include the transaction before it expired. Nothing was charged. Try again. Reference: ${signature}`
          : `The transaction was sent but is not confirmed yet. Check it before trying again. Reference: ${signature}`,
      );
    }

    if (Date.now() - lastSend >= 2500) {
      lastSend = Date.now();
      broadcast(raw).catch(() => {});
    }
    await sleep(1200);
  }
}

export const friendlyError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return "Cancelled in the wallet. Nothing was sent.";
  if (/429|too many requests/i.test(msg)) return "Solana is rate-limiting requests. Wait a few seconds and try again.";
  if (/failed to fetch|networkerror|load failed|ECONN|timed? ?out/i.test(msg)) return "Could not reach Solana. Check your connection and try again.";
  return msg;
};
