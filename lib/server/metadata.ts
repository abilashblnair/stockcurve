import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Token metadata documents, content-addressed. The URL is written on chain and
// DBC tokens are created with immutable metadata, so files are never deleted.

const DIR = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), ".data"), "meta");

export type MetadataInput = { name: string; symbol: string; description?: string; image?: string; website?: string; x?: string; stock?: string };

const httpsOrEmpty = (v?: string) => (v && /^https:\/\/[^\s]{3,300}$/.test(v.trim()) ? v.trim() : undefined);

export function buildDocument(i: MetadataInput) {
  const name = String(i.name ?? "").trim().slice(0, 32);
  const symbol = String(i.symbol ?? "").trim().toUpperCase().slice(0, 10);
  const doc: Record<string, unknown> = {
    name,
    symbol,
    description: String(i.description ?? "").trim().slice(0, 500),
  };
  const image = httpsOrEmpty(i.image);
  if (image) doc.image = image;
  const website = httpsOrEmpty(i.website);
  if (website) doc.external_url = website;
  const extensions: Record<string, string> = {};
  if (website) extensions.website = website;
  const x = String(i.x ?? "").trim().replace(/^@/, "");
  if (/^[A-Za-z0-9_]{1,15}$/.test(x)) extensions.twitter = `https://x.com/${x}`;
  if (i.stock) extensions.quote_asset = String(i.stock).slice(0, 16);
  extensions.launched_with = "stockcurve";
  doc.extensions = extensions;
  return doc;
}

export function storeDocument(doc: Record<string, unknown>): string {
  const body = JSON.stringify(doc);
  const id = crypto.createHash("sha256").update(body).digest("hex").slice(0, 24);
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${id}.json`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, body);
  return id;
}

export function readDocument(id: string): string | null {
  if (!/^[0-9a-f]{24}$/.test(id)) return null;
  try {
    return fs.readFileSync(path.join(DIR, `${id}.json`), "utf8");
  } catch {
    return null;
  }
}

export function publicBase(requestOrigin: string): string {
  return (process.env.PUBLIC_BASE_URL ?? requestOrigin).replace(/\/$/, "");
}
