import "server-only";
import BN from "bn.js";
import type { PublicKey } from "@solana/web3.js";
import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  FEE_DENOMINATOR,
  PROTOCOL_FEE_PERCENT,
  Rounding,
  getBaseFeeNumeratorByPeriod,
  getDeltaAmountBaseUnsigned,
  getDeltaAmountQuoteUnsigned,
  getMigrationThresholdPrice,
  getPriceFromSqrtPrice,
  validateConfigParameters,
  type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";

// Everything the builder and the monitor draw, as plain numbers.

export type CurvePoint = { raised: number; sold: number; price: number };
export type FeePoint = { t: number; bps: number };

export type CurveModel = {
  startPrice: number; // stock per token
  graduationPrice: number;
  soldOnCurve: number; // tokens
  lpTokens: number; // tokens paired at graduation
  totalSupply: number;
  graduationRaise: number; // stock
  points: CurvePoint[];
};

const toNum = (b: BN, decimals: number) => Number(b.toString()) / 10 ** decimals;

export function curveModel(
  cfg: { sqrtStartPrice: BN; curve: { sqrtPrice: BN; liquidity: BN }[]; migrationQuoteThreshold: BN; tokenDecimal: number },
  quoteDecimals: number,
  totalSupplyRaw: BN,
  samples = 48,
): CurveModel {
  const baseDec = cfg.tokenDecimal;
  const migSqrt: BN = getMigrationThresholdPrice(cfg.migrationQuoteThreshold, cfg.sqrtStartPrice, cfg.curve);
  const points: CurvePoint[] = [];
  let raised = new BN(0);
  let sold = new BN(0);
  let lower = cfg.sqrtStartPrice;
  const price = (s: BN) => Number(getPriceFromSqrtPrice(s, baseDec, quoteDecimals).toString());
  points.push({ raised: 0, sold: 0, price: price(lower) });

  // Spread samples across segments in proportion to sqrt-price distance.
  const span = migSqrt.sub(cfg.sqrtStartPrice);
  for (const seg of cfg.curve) {
    if (lower.gte(migSqrt)) break;
    const upper = BN.min(seg.sqrtPrice, migSqrt);
    if (upper.lte(lower) || seg.liquidity.isZero()) {
      lower = BN.max(lower, upper);
      continue;
    }
    const share = span.isZero() ? 1 : Number(upper.sub(lower).muln(1000).div(span).toString()) / 1000;
    const n = Math.max(2, Math.round(samples * share));
    let prev = lower;
    for (let k = 1; k <= n; k++) {
      const s = k === n ? upper : lower.add(upper.sub(lower).muln(k).divn(n));
      raised = raised.add(getDeltaAmountQuoteUnsigned(prev, s, seg.liquidity, Rounding.Up));
      sold = sold.add(getDeltaAmountBaseUnsigned(prev, s, seg.liquidity, Rounding.Down));
      points.push({ raised: toNum(raised, quoteDecimals), sold: toNum(sold, baseDec), price: price(s) });
      prev = s;
    }
    lower = upper;
  }

  const totalSupply = toNum(totalSupplyRaw, baseDec);
  const soldOnCurve = toNum(sold, baseDec);
  return {
    startPrice: price(cfg.sqrtStartPrice),
    graduationPrice: price(migSqrt),
    soldOnCurve,
    lpTokens: Math.max(0, totalSupply - soldOnCurve),
    totalSupply,
    graduationRaise: toNum(cfg.migrationQuoteThreshold, quoteDecimals),
    points,
  };
}

export type FeeModel = {
  startBps: number;
  endBps: number;
  durationSec: number;
  points: FeePoint[];
  protocolPct: number;
  creatorPct: number;
  partnerPct: number;
  dynamic: boolean;
};

type BaseFeeLike = { cliffFeeNumerator: BN; firstFactor: number; secondFactor: BN; thirdFactor: BN; baseFeeMode: number };

export function feeBpsAt(baseFee: BaseFeeLike, elapsedSec: number): number {
  const periods = baseFee.firstFactor;
  const freq = Number(baseFee.secondFactor.toString());
  if (!periods || !freq || baseFee.baseFeeMode > 1) return Number(baseFee.cliffFeeNumerator.toString()) / (FEE_DENOMINATOR / 10_000);
  const period = new BN(Math.max(0, Math.floor(elapsedSec / freq)));
  const num = getBaseFeeNumeratorByPeriod(baseFee.cliffFeeNumerator, periods, period, baseFee.thirdFactor, baseFee.baseFeeMode);
  return Number(num.toString()) / (FEE_DENOMINATOR / 10_000);
}

export function feeModel(baseFee: BaseFeeLike, creatorTradingFeePercentage: number, dynamic: boolean): FeeModel {
  const periods = baseFee.firstFactor;
  const freq = Number(baseFee.secondFactor.toString());
  const durationSec = periods && freq ? periods * freq : 0;
  const points: FeePoint[] = [];
  const steps = 60;
  const shown = durationSec || 3600;
  for (let i = 0; i <= steps; i++) {
    const t = Math.round((shown * i) / steps);
    points.push({ t, bps: feeBpsAt(baseFee, t) });
  }
  const rest = 100 - PROTOCOL_FEE_PERCENT;
  return {
    startBps: feeBpsAt(baseFee, 0),
    endBps: feeBpsAt(baseFee, durationSec + 1),
    durationSec,
    points,
    protocolPct: PROTOCOL_FEE_PERCENT,
    creatorPct: (rest * creatorTradingFeePercentage) / 100,
    partnerPct: (rest * (100 - creatorTradingFeePercentage)) / 100,
    dynamic,
  };
}

/** Runs the SDK's own validation; returns the first error message or null. */
export function sdkValidation(cp: ConfigParameters, leftoverReceiver: PublicKey = DYNAMIC_BONDING_CURVE_PROGRAM_ID): string | null {
  try {
    // The token-supply check parses leftoverReceiver; any real key works when leftover is 0.
    validateConfigParameters({ ...cp, leftoverReceiver } as Parameters<typeof validateConfigParameters>[0]);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
