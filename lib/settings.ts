// Launch settings, presets and checks. Client-safe: no SDK imports.
import { STOCKS } from "./stocks.ts";

export const KEEPER_MIN_USD = 750;
export const MIGRATED_FEE_OPTIONS = [25, 30, 100, 200, 400, 600] as const;
export type MigratedFeeBps = (typeof MIGRATED_FEE_OPTIONS)[number];

export type FeeCurve = "exponential" | "linear" | "flat";

export type LaunchSettings = {
  stockMint: string;
  graduationUsd: number;
  feeCurve: FeeCurve;
  startFeeBps: number;
  endFeeBps: number;
  openingMinutes: number;
  dynamicFee: boolean;
  creatorFeeShare: number; // % of the non-protocol trading fee to the creator
  totalSupply: number;
  baseDecimals: 6 | 9;
  lpSupplyPct: number; // % of supply paired into DAMM v2 at graduation
  partnerLockedPct: number;
  partnerUnlockedPct: number;
  creatorLockedPct: number;
  creatorUnlockedPct: number;
  migratedFeeBps: MigratedFeeBps;
};

export const DEFAULT_SETTINGS: LaunchSettings = {
  stockMint: STOCKS[0].mint,
  graduationUsd: 1000,
  feeCurve: "exponential",
  startFeeBps: 2500,
  endFeeBps: 100,
  openingMinutes: 60,
  dynamicFee: true,
  creatorFeeShare: 50,
  totalSupply: 1_000_000_000,
  baseDecimals: 6,
  lpSupplyPct: 20,
  partnerLockedPct: 50,
  partnerUnlockedPct: 0,
  creatorLockedPct: 50,
  creatorUnlockedPct: 0,
  migratedFeeBps: 100,
};

export type Preset = { id: string; name: string; blurb: string; patch: Partial<LaunchSettings> };

export const PRESETS: Preset[] = [
  {
    id: "opening-auction",
    name: "Opening auction",
    blurb: "25% fee decaying to 1% over the first hour. Snipers pay the early premium; price settles before the steady fee.",
    patch: { feeCurve: "exponential", startFeeBps: 2500, endFeeBps: 100, openingMinutes: 60, dynamicFee: true, lpSupplyPct: 20 },
  },
  {
    id: "soft-open",
    name: "Soft open",
    blurb: "5% falling linearly to 1% over 15 minutes. For communities that already know the price range.",
    patch: { feeCurve: "linear", startFeeBps: 500, endFeeBps: 100, openingMinutes: 15, dynamicFee: true, lpSupplyPct: 25 },
  },
  {
    id: "flat",
    name: "Flat 1%",
    blurb: "One fee from the first trade, volatility fee on top. The simplest schedule to explain.",
    patch: { feeCurve: "flat", startFeeBps: 100, endFeeBps: 100, openingMinutes: 0, dynamicFee: true, lpSupplyPct: 20 },
  },
];

/** USD value of one whole (unscaled) stock token: price is per displayed unit, display = raw * multiplier. */
export function usdPerStockToken(stockUsd: number, multiplier = 1): number {
  return stockUsd * multiplier;
}

export function graduationInStock(stockUsd: number, graduationUsd = 1000, multiplier = 1): number {
  if (graduationUsd < KEEPER_MIN_USD) throw new Error(`Graduation must be at least $${KEEPER_MIN_USD} for Meteora's migration keeper`);
  // Round up to 2 decimals so the threshold never lands under the USD target.
  return Math.ceil((graduationUsd / usdPerStockToken(stockUsd, multiplier)) * 100) / 100;
}

/** Problems a person can fix, in plain words. Empty means the settings are buildable. */
export function checkSettings(s: LaunchSettings): string[] {
  const out: string[] = [];
  const lp = s.partnerLockedPct + s.partnerUnlockedPct + s.creatorLockedPct + s.creatorUnlockedPct;
  if (Math.round(lp) !== 100) out.push(`LP split adds up to ${lp}%, it must be 100%.`);
  if (s.partnerLockedPct + s.creatorLockedPct < 10) out.push("At least 10% of graduation liquidity must be permanently locked.");
  if (s.graduationUsd < KEEPER_MIN_USD) out.push(`Graduation must be at least $${KEEPER_MIN_USD}.`);
  if (s.startFeeBps > 9900 || s.startFeeBps < 25) out.push("Starting fee must be between 0.25% and 99%.");
  if (s.endFeeBps < 25) out.push("Steady fee must be at least 0.25%.");
  if (s.feeCurve !== "flat" && s.endFeeBps >= s.startFeeBps) out.push("Steady fee must be below the starting fee (or pick Flat).");
  if (s.feeCurve !== "flat" && !(s.openingMinutes >= 1 && s.openingMinutes <= 1440)) out.push("Opening window must be 1 minute to 24 hours.");
  if (!(s.lpSupplyPct >= 5 && s.lpSupplyPct <= 60)) out.push("Supply paired at graduation must be 5% to 60%.");
  if (!(s.creatorFeeShare >= 0 && s.creatorFeeShare <= 100)) out.push("Creator fee share must be 0% to 100%.");
  if (!(s.totalSupply >= 1_000_000 && s.totalSupply <= 1_000_000_000_000)) out.push("Total supply must be 1M to 1T.");
  if (!MIGRATED_FEE_OPTIONS.includes(s.migratedFeeBps)) out.push("Pick a post-graduation pool fee from the list.");
  return out;
}

