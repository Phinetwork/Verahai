/* eslint-disable @typescript-eslint/consistent-type-definitions */
/**
 * SigilMarkets — risk.ts
 *
 * Deterministic, offline-safe risk math for binary prophecy markets.
 *
 * Model (contract-style)
 * - A YES/NO contract costs `price` (0..1) and pays 1 if it resolves true, else 0.
 * - Spending `stake` buys `shares = stake / price`.
 * - If outcome resolves in your favor:
 *     payout = shares * 1
 *     profit = payout - stake
 * - If outcome resolves against you:
 *     loss = stake  (max loss, long-only)
 *
 * Everything is computed in integer "micro" units:
 * - PRICE_SCALE = 1_000_000 means 1.0 == 1,000,000 micro (100.0000%)
 * - stake/payout/profit are in "value micro" (e.g., Φ micro, USD micro, etc.)
 *
 * This file:
 * - Never uses `any`
 * - Avoids floating math (BigInt internal), deterministic across devices
 */

export const PRICE_SCALE = 1_000_000 as const;
export const FRACTION_SCALE = 1_000_000 as const;

export type Side = "YES" | "NO";

export type RiskPolicy = Readonly<{
  /**
   * Maximum fraction of bankroll to spend on a single position (micro fraction).
   * Example: 50_000 = 5%
   */
  maxStakeFractionMicro: number;

  /**
   * Multiplier applied to Kelly fraction (micro fraction).
   * Example: 500_000 = 0.5x Kelly (half Kelly)
   */
  kellyMultiplierMicro: number;

  /**
   * Minimum edge (belief - price) required before we recommend any stake.
   * Example: 2_000 = 0.2%
   */
  minEdgeMicro: number;

  /**
   * Clamp prices away from 0/1 to prevent infinite odds / division issues.
   */
  minPriceMicro: number;
  maxPriceMicro: number;

  /**
   * Backstop: absolute max stake micro (optional).
   * If not provided, only maxStakeFractionMicro is used.
   */
  absoluteMaxStakeMicro?: number;

  /**
   * Optional cap: maximum recommended shares (payout exposure) as a fraction of bankroll.
   * Example: 300_000 = payout exposure up to 30% of bankroll
   */
  maxPayoutExposureFractionMicro?: number;
}>;

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  maxStakeFractionMicro: 50_000, // 5%
  kellyMultiplierMicro: 500_000, // 0.5x Kelly
  minEdgeMicro: 2_000, // 0.2%
  minPriceMicro: 5_000, // 0.5%
  maxPriceMicro: 995_000, // 99.5%
  absoluteMaxStakeMicro: undefined,
  maxPayoutExposureFractionMicro: 400_000, // 40%
};

export type RiskAssessment = Readonly<{
  side: Side;

  // Inputs (normalized)
  bankrollMicro: number;
  beliefYesMicro: number;
  priceMicro: number;

  // Core computed
  edgeMicro: number; // favorable edge in micro probability units
  kellyFractionMicro: number; // micro fraction of bankroll
  recommendedStakeMicro: number;

  // Exposure / payoff
  stakeMicro: number;
  sharesMicro: number; // payout if win (in value micro)
  maxLossMicro: number; // stake
  maxProfitMicro: number; // shares - stake

  // Derived
  stakeFractionMicro: number; // stake / bankroll
  payoutExposureFractionMicro: number; // shares / bankroll
  grade: "LOW" | "MEDIUM" | "HIGH";
  reasons: readonly string[];
}>;

/* ─────────────────────────────────────────────────────────────
   Utilities (no floats, deterministic)
───────────────────────────────────────────────────────────── */

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const x = Math.trunc(n);
  return Math.max(min, Math.min(max, x));
}

function toBig(n: number): bigint {
  // Clamp to safe integer range before converting to BigInt
  const x = clampInt(n, 0, Number.MAX_SAFE_INTEGER);
  return BigInt(x);
}

function fromBigClamped(b: bigint): number {
  if (b <= 0n) return 0;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const clamped = b > max ? max : b;
  return Number(clamped);
}

function mulDivFloor(a: number, b: number, d: number): number {
  // floor(a*b/d) with BigInt, all non-negative
  const dd = Math.max(1, Math.trunc(d));
  const res = (toBig(a) * toBig(b)) / BigInt(dd);
  return fromBigClamped(res);
}

function microFrac(num: number, den: number): number {
  // floor(num/den * FRACTION_SCALE)
  if (den <= 0) return 0;
  return mulDivFloor(num, FRACTION_SCALE, den);
}

export function clampPriceMicro(priceMicro: number, policy: RiskPolicy = DEFAULT_RISK_POLICY): number {
  return clampInt(priceMicro, policy.minPriceMicro, policy.maxPriceMicro);
}

export function clampProbMicro(pYesMicro: number): number {
  return clampInt(pYesMicro, 0, PRICE_SCALE);
}

export function complementProbMicro(pYesMicro: number): number {
  return PRICE_SCALE - clampProbMicro(pYesMicro);
}

/**
 * Favorable edge in micro-probability units.
 * - For YES: edge = beliefYes - priceYes
 * - For NO:  edge = beliefNo  - priceNo  where beliefNo = 1 - beliefYes
 */
export function edgeMicro(side: Side, beliefYesMicro: number, priceMicro: number): number {
  const bYes = clampProbMicro(beliefYesMicro);
  const p = clampInt(priceMicro, 0, PRICE_SCALE);
  if (side === "YES") return bYes - p;
  const bNo = PRICE_SCALE - bYes;
  return bNo - p;
}

/**
 * Kelly fraction (micro fraction of bankroll to spend), long-only contract model.
 * YES:
 *   f* = (q - p) / (1 - p)
 * NO (using qNo, pNo):
 *   f* = (qNo - pNo) / (1 - pNo)
 *
 * Returns 0 if edge <= 0.
 */
export function kellyFractionMicro(
  side: Side,
  beliefYesMicro: number,
  priceMicro: number,
  policy: RiskPolicy = DEFAULT_RISK_POLICY
): number {
  const p = clampPriceMicro(priceMicro, policy);
  const e = edgeMicro(side, beliefYesMicro, p);
  if (e <= 0) return 0;

  const denom = PRICE_SCALE - p;
  if (denom <= 0) return 0;

  // floor( e / (1 - p) * FRACTION_SCALE )
  return microFrac(e, denom);
}

/**
 * Convert a stake (spent) into shares/payout exposure.
 * shares = stake / price  (scaled: stake * PRICE_SCALE / priceMicro)
 */
export function sharesForStakeMicro(stakeMicro: number, priceMicro: number, policy: RiskPolicy = DEFAULT_RISK_POLICY): number {
  const stake = clampInt(stakeMicro, 0, Number.MAX_SAFE_INTEGER);
  const p = clampPriceMicro(priceMicro, policy);
  return mulDivFloor(stake, PRICE_SCALE, p);
}

/**
 * Profit if the contract resolves in your favor:
 * profit = shares - stake
 */
export function maxProfitForStakeMicro(stakeMicro: number, priceMicro: number, policy: RiskPolicy = DEFAULT_RISK_POLICY): number {
  const stake = clampInt(stakeMicro, 0, Number.MAX_SAFE_INTEGER);
  const shares = sharesForStakeMicro(stake, priceMicro, policy);
  return Math.max(0, shares - stake);
}

/**
 * Stake fraction of bankroll (micro fraction).
 */
export function stakeFractionMicro(stakeMicro: number, bankrollMicro: number): number {
  const b = clampInt(bankrollMicro, 0, Number.MAX_SAFE_INTEGER);
  if (b <= 0) return 0;
  const s = clampInt(stakeMicro, 0, Number.MAX_SAFE_INTEGER);
  return microFrac(s, b);
}

/**
 * Payout exposure fraction of bankroll (micro fraction).
 */
export function payoutExposureFractionMicro(sharesMicro: number, bankrollMicro: number): number {
  const b = clampInt(bankrollMicro, 0, Number.MAX_SAFE_INTEGER);
  if (b <= 0) return 0;
  const sh = clampInt(sharesMicro, 0, Number.MAX_SAFE_INTEGER);
  return microFrac(sh, b);
}

/* ─────────────────────────────────────────────────────────────
   Recommendation + Assessment
───────────────────────────────────────────────────────────── */

export function recommendedStakeMicro(params: Readonly<{
  side: Side;
  bankrollMicro: number;
  beliefYesMicro: number;
  priceMicro: number;
  policy?: RiskPolicy;
  /**
   * Optional override: if true, uses full Kelly (ignores policy.kellyMultiplierMicro).
   */
  fullKelly?: boolean;
}>): number {
  const policy = params.policy ?? DEFAULT_RISK_POLICY;

  const bankroll = clampInt(params.bankrollMicro, 0, Number.MAX_SAFE_INTEGER);
  if (bankroll <= 0) return 0;

  const price = clampPriceMicro(params.priceMicro, policy);
  const e = edgeMicro(params.side, params.beliefYesMicro, price);

  // Edge gate (prevents noise trades)
  if (e < policy.minEdgeMicro) return 0;

  const k = kellyFractionMicro(params.side, params.beliefYesMicro, price, policy);
  if (k <= 0) return 0;

  const mult = params.fullKelly === true ? FRACTION_SCALE : clampInt(policy.kellyMultiplierMicro, 0, FRACTION_SCALE);

  // stake = bankroll * kellyFraction * kellyMultiplier
  const stakeFromKelly = mulDivFloor(mulDivFloor(bankroll, k, FRACTION_SCALE), mult, FRACTION_SCALE);

  const maxByFraction = mulDivFloor(bankroll, clampInt(policy.maxStakeFractionMicro, 0, FRACTION_SCALE), FRACTION_SCALE);

  let stake = Math.min(stakeFromKelly, maxByFraction);

  if (typeof policy.absoluteMaxStakeMicro === "number") {
    stake = Math.min(stake, clampInt(policy.absoluteMaxStakeMicro, 0, Number.MAX_SAFE_INTEGER));
  }

  // Optional cap: payout exposure vs bankroll
  if (typeof policy.maxPayoutExposureFractionMicro === "number") {
    const maxExposure = mulDivFloor(
      bankroll,
      clampInt(policy.maxPayoutExposureFractionMicro, 0, FRACTION_SCALE),
      FRACTION_SCALE
    );
    const shares = sharesForStakeMicro(stake, price, policy);
    if (shares > maxExposure && maxExposure > 0) {
      // reduce stake so that shares <= maxExposure:
      // shares = stake * PRICE_SCALE / price  => stake = shares * price / PRICE_SCALE
      const adjusted = mulDivFloor(maxExposure, price, PRICE_SCALE);
      stake = Math.min(stake, adjusted);
    }
  }

  return clampInt(stake, 0, Number.MAX_SAFE_INTEGER);
}

export function assessTradeRisk(params: Readonly<{
  side: Side;
  bankrollMicro: number;
  beliefYesMicro: number;
  priceMicro: number;
  stakeMicro?: number; // if omitted, uses recommended
  policy?: RiskPolicy;
}>): RiskAssessment {
  const policy = params.policy ?? DEFAULT_RISK_POLICY;

  const bankrollMicro = clampInt(params.bankrollMicro, 0, Number.MAX_SAFE_INTEGER);
  const beliefYesMicro = clampProbMicro(params.beliefYesMicro);
  const priceMicro = clampPriceMicro(params.priceMicro, policy);

  const e = edgeMicro(params.side, beliefYesMicro, priceMicro);
  const k = kellyFractionMicro(params.side, beliefYesMicro, priceMicro, policy);

  const stakeMicro =
    typeof params.stakeMicro === "number"
      ? clampInt(params.stakeMicro, 0, Number.MAX_SAFE_INTEGER)
      : recommendedStakeMicro({
          side: params.side,
          bankrollMicro,
          beliefYesMicro,
          priceMicro,
          policy,
        });

  const sharesMicro = sharesForStakeMicro(stakeMicro, priceMicro, policy);
  const maxLossMicro = stakeMicro;
  const maxProfitMicro = Math.max(0, sharesMicro - stakeMicro);

  const stakeFrac = stakeFractionMicro(stakeMicro, bankrollMicro);
  const exposureFrac = payoutExposureFractionMicro(sharesMicro, bankrollMicro);

  const reasons: string[] = [];

  if (e < policy.minEdgeMicro) reasons.push("Edge below threshold");
  if (priceMicro <= policy.minPriceMicro + 1_000) reasons.push("Price near minimum clamp (very high odds)");
  if (priceMicro >= policy.maxPriceMicro - 1_000) reasons.push("Price near maximum clamp (very low upside)");
  if (stakeFrac > policy.maxStakeFractionMicro) reasons.push("Stake exceeds policy max fraction");
  if (
    typeof policy.maxPayoutExposureFractionMicro === "number" &&
    exposureFrac > clampInt(policy.maxPayoutExposureFractionMicro, 0, FRACTION_SCALE)
  ) {
    reasons.push("Payout exposure exceeds cap");
  }

  // Grade heuristic: driven by bankroll fraction at risk + extreme price regimes.
  let grade: "LOW" | "MEDIUM" | "HIGH" = "LOW";

  // Risk score buckets (micro)
  // - <= 1% bankroll risk: LOW
  // - <= 5% bankroll risk: MEDIUM
  // - > 5% bankroll risk: HIGH
  if (stakeFrac > 50_000) grade = "HIGH";
  else if (stakeFrac > 10_000) grade = "MEDIUM";

  // Increase grade when price is extreme (tail risk / liquidation via emotion, not math)
  if (priceMicro <= 10_000 || priceMicro >= 990_000) {
    grade = grade === "LOW" ? "MEDIUM" : "HIGH";
    reasons.push("Extreme price regime");
  }

  // If edge is strong and stake is tiny, keep LOW
  if (e >= 25_000 && stakeFrac <= 10_000) {
    // leave as-is; this is typically fine
  }

  return {
    side: params.side,
    bankrollMicro,
    beliefYesMicro,
    priceMicro,
    edgeMicro: e,
    kellyFractionMicro: k,
    recommendedStakeMicro: recommendedStakeMicro({
      side: params.side,
      bankrollMicro,
      beliefYesMicro,
      priceMicro,
      policy,
    }),
    stakeMicro,
    sharesMicro,
    maxLossMicro,
    maxProfitMicro,
    stakeFractionMicro: stakeFrac,
    payoutExposureFractionMicro: exposureFrac,
    grade,
    reasons,
  };
}

/**
 * Convenience: given YES and NO prices, pick the correct price for a side.
 * (No assumptions that prices sum to 1.0; spreads are allowed.)
 */
export function priceForSideMicro(side: Side, yesPriceMicro: number, noPriceMicro: number, policy: RiskPolicy = DEFAULT_RISK_POLICY): number {
  const y = clampPriceMicro(yesPriceMicro, policy);
  const n = clampPriceMicro(noPriceMicro, policy);
  return side === "YES" ? y : n;
}
