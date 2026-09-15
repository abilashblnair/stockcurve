import type { Connection } from "@solana/web3.js";

/**
 * Poll signature status and re-broadcast the signed bytes every 2s until the
 * blockhash expires. Under load Solana drops transactions without rejecting
 * them; send-once-and-wait is how "expired before confirmation" happens.
 */
export async function waitForConfirmation(connection: Connection, signature: string, lastValidBlockHeight: number, raw: Uint8Array): Promise<void> {
  let lastSend = Date.now();
  for (;;) {
    const s = (await connection.getSignatureStatuses([signature])).value[0];
    if (s?.err) throw new Error("Transaction failed on chain: " + JSON.stringify(s.err));
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    if ((await connection.getBlockHeight()) > lastValidBlockHeight) {
      await new Promise((r) => setTimeout(r, 1500));
      const again = (await connection.getSignatureStatuses([signature])).value[0];
      if (again && !again.err && again.confirmationStatus) return;
      throw new Error("The network did not include the transaction before it expired. Nothing was charged; try again.");
    }
    if (Date.now() - lastSend >= 2000) {
      lastSend = Date.now();
      connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
