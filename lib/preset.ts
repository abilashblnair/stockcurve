// DBC configs quoted in a tokenized stock.
//
// Everything a launch is configured with lives in LaunchSettings (plain JSON,
// safe to send from the browser). toConfigParameters() turns it into the
// SDK's ConfigParameters. Presets are named LaunchSettings patches.
//
// Why these knobs for equity-quoted launches:
// - Quote token is the stock, so the curve reserve is equity exposure and
//   every trading fee is paid in the stock.
// - Opening auction: the base fee starts high and decays, so snipers pay for
//   being first and price discovery settles before the steady fee applies.
// - Graduation is set in USD and converted at build time, with headroom over
//   Meteora's 750 USD keeper minimum for stock quote pairs.
// - Post-graduation LP defaults to 100% permanently locked.
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurve,
  type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { STOCKS as STOCK_LIST, type StockMeta } from "./stocks.ts";
import { DEFAULT_SETTINGS, checkSettings, graduationInStock, type LaunchSettings, type MigratedFeeBps } from "./settings.ts";

export * from "./settings.ts";

const MIGRATION_FEE_OPTION: Record<MigratedFeeBps, MigrationFeeOption> = {
  25: MigrationFeeOption.FixedBps25,
  30: MigrationFeeOption.FixedBps30,
  100: MigrationFeeOption.FixedBps100,
  200: MigrationFeeOption.FixedBps200,
  400: MigrationFeeOption.FixedBps400,
  600: MigrationFeeOption.FixedBps600,
};

export function toConfigParameters(s: LaunchSettings, stock: { decimals: number; usd: number; multiplier?: number }): ConfigParameters {
  const problems = checkSettings(s);
  if (problems.length) throw new Error(problems[0]);
  const flat = s.feeCurve === "flat";
  const seconds = Math.round(s.openingMinutes * 60);
  // One fee step per period; ~2 steps a minute, bounded.
  const periods = flat ? 0 : Math.max(2, Math.min(240, Math.round(s.openingMinutes * 2)));
  return buildCurve({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: s.baseDecimals === 9 ? TokenDecimal.NINE : TokenDecimal.SIX,
      tokenQuoteDecimal: stock.decimals as TokenDecimal,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: s.totalSupply,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: s.feeCurve === "linear" ? BaseFeeMode.FeeSchedulerLinear : BaseFeeMode.FeeSchedulerExponential,
        feeSchedulerParam: {
          startingFeeBps: flat ? s.endFeeBps : s.startFeeBps,
          endingFeeBps: s.endFeeBps,
          numberOfPeriod: periods,
          totalDuration: flat ? 0 : seconds,
        },
      },
      dynamicFeeEnabled: s.dynamicFee,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: s.creatorFeeShare,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MIGRATION_FEE_OPTION[s.migratedFeeBps],
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: s.partnerLockedPct,
      partnerLiquidityPercentage: s.partnerUnlockedPct,
      creatorPermanentLockedLiquidityPercentage: s.creatorLockedPct,
      creatorLiquidityPercentage: s.creatorUnlockedPct,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    percentageSupplyOnMigration: s.lpSupplyPct,
    migrationQuoteThreshold: graduationInStock(stock.usd, s.graduationUsd, stock.multiplier),
  });
}

// ---- used by the go/no-go scripts ----

export type Stock = { symbol: string; mint: string; decimals: number };
export const STOCKS: Record<string, Stock> = Object.fromEntries(
  STOCK_LIST.map((s: StockMeta) => [s.symbol, { symbol: s.symbol, mint: s.mint, decimals: s.decimals }]),
);

export function equityPreset(p: { stock: Stock; stockUsd: number; graduationUsd?: number }) {
  return toConfigParameters({ ...DEFAULT_SETTINGS, stockMint: p.stock.mint, graduationUsd: p.graduationUsd ?? 1000 }, { decimals: p.stock.decimals, usd: p.stockUsd });
}

export async function stockUsd(mint: string): Promise<number> {
  const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
  const j = (await r.json()) as Record<string, { usdPrice?: number }>;
  const price = j[mint]?.usdPrice;
  if (!price) throw new Error(`no Jupiter price for ${mint}`);
  return price;
}
