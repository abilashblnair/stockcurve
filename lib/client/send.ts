import { VersionedTransaction, type Connection, type Keypair } from "@solana/web3.js";
import { waitForConfirmation } from "./confirm";

type Signer = <T extends VersionedTransaction>(tx: T) => Promise<T>;

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Sign a server-built transaction in the wallet, send it from here, and wait
 * for confirmation (re-broadcasting until the blockhash expires).
 * extraSigners: keys generated in this browser (e.g. a new mint) that must sign first.
 */
export async function signSendConfirm(
  connection: Connection,
  signTransaction: Signer,
  txBase64: string,
  lastValidBlockHeight: number,
  extraSigners: Keypair[] = [],
): Promise<string> {
  const vtx = VersionedTransaction.deserialize(fromBase64(txBase64));
  if (extraSigners.length) vtx.sign(extraSigners);
  const signed = await signTransaction(vtx);
  const raw = signed.serialize();
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  await waitForConfirmation(connection, signature, lastValidBlockHeight, raw);
  return signature;
}

export const friendlyError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return "Cancelled in the wallet. Nothing was sent.";
  return msg;
};
