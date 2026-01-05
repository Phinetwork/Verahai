// SigilMarkets/types/marketTypes.ts
/* eslint-disable @typescript-eslint/consistent-type-definitions */
/**
 * SigilMarkets — marketTypes (normative)
 *
 * Design goals:
 * - Deterministic, reconstructable market state from a stream of events.
 * - Kai-Klok native time: pulses are the only wall-clock we care about here.
 * - Value units are represented as integer micro-units for stability.
 *
 * Units:
 * - PhiMicro: integer micro-Φ (1 Φ = 1_000_000 microΦ)
 * - ShareMicro: integer micro-shares (1 share = 1_000_000 microShares)
 * - PriceMicro: microΦ per 1 share (0..ONE_PHI_MICRO, where 1 share redeems ONE_PHI_MICRO on win)
 */

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type MarketId = Brand<string, "MarketId">;
export const asMarketId = (v: string): MarketId => v as MarketId;

export type MarketSlug = Brand<string, "MarketSlug">;
export const asMarketSlug = (v: string): MarketSlug => v as MarketSlug;

export type OracleId = Brand<string, "OracleId">;
export const asOracleId = (v: string): OracleId => v as OracleId;

export type EvidenceHash = Brand<string, "EvidenceHash">;
export const asEvidenceHash = (v: string): EvidenceHash => v as EvidenceHash;

export type VaultId = Brand<string, "VaultId">;
export const asVaultId = (v: string): VaultId => v as VaultId;

export type LockId = Brand<string, "LockId">;
export const asLockId = (v: string): LockId => v as LockId;

/** Kai time (pulse-level). */
export type KaiPulse = number;

/** Kai moment (for UI + provenance). */
export type KaiMoment = Readonly<{
  pulse: KaiPulse;
  beat: number;
  stepIndex: number;
}>;

/** Integer micro-Φ (deterministic). */
export type PhiMicro = bigint;

/** Integer micro-shares (deterministic). */
export type ShareMicro = bigint;

/**
 * PriceMicro is represented as microΦ per 1 share.
 * A winning share redeems at ONE_PHI_MICRO microΦ.
 */
export type PriceMicro = PhiMicro;

/**
 * Decimal string encoding for bigint micro units in JSON.
 * Canonical: non-negative base-10 integer, no leading zeros except "0".
 */
export type MicroDecimalString = Brand<string, "MicroDecimalString">;

export const asMicroDecimalString = (v: string): MicroDecimalString => {
  const s = v.trim();
  if (!/^(0|[1-9]\d*)$/.test(s)) {
    throw new Error(`invalid MicroDecimalString: ${v}`);
  }
  return s as MicroDecimalString;
};

export const ONE_PHI_MICRO: PhiMicro = 1_000_000n;
export const ONE_SHARE_MICRO: ShareMicro = 1_000_000n;

/** Basis points (0..10_000). */
export type Bps = number;

export type MarketSide = "YES" | "NO";
export const isMarketSide = (v: unknown): v is MarketSide => v === "YES" || v === "NO";
export const oppositeSide = (side: MarketSide): MarketSide => (side === "YES" ? "NO" : "YES");

export type MarketOutcome = MarketSide | "VOID";
export const isMarketOutcome = (v: unknown): v is MarketOutcome => v === "YES" || v === "NO" || v === "VOID";

export type MarketKind = "binary";
export const MARKET_KIND_BINARY: MarketKind = "binary";

/**
 * Market status is about the lifecycle of trading + resolution.
 * - open: trading allowed
 * - closed: trading halted (closePulse reached) awaiting resolution
 * - resolving: resolution process underway (may include disputes)
 * - resolved: final outcome set
 * - voided: market invalid (refund policy applies)
 * - canceled: creator/admin canceled before close (refund policy applies)
 */
export type MarketStatus = "open" | "closed" | "resolving" | "resolved" | "voided" | "canceled";
export const isMarketStatus = (v: unknown): v is MarketStatus =>
  v === "open" || v === "closed" || v === "resolving" || v === "resolved" || v === "voided" || v === "canceled";

/**
 * Category is intentionally extensible.
 * Use the known literals for UI grouping; allow custom categories as branded strings.
 */
export type MarketCategory =
  | "pulse"
  | "kai"
  | "calendar"
  | "weather"
  | "sports"
  | "politics"
  | "crypto"
  | "finance"
  | "tech"
  | "science"
  | "culture"
  | "world"
  | "local"
  | "other"
  | (string & { readonly __marketCategory?: "custom" });

/** Timing rules for a market. */
export type MarketTiming = Readonly<{
  /** When the market was created (for provenance). */
  createdPulse: KaiPulse;
  /** When trading opens (often equals createdPulse). */
  openPulse: KaiPulse;
  /** When trading closes (hard stop). */
  closePulse: KaiPulse;
  /**
   * Earliest pulse at which resolution is allowed to finalize.
   * Useful when outcomes depend on data that becomes available after close.
   */
  resolveEarliestPulse?: KaiPulse;
  /**
   * Optional “resolve-by” target (soft SLA). Not a hard requirement.
   * UI can show “Expected by …” without affecting determinism.
   */
  resolveByPulse?: KaiPulse;
}>;

/** Settlement policy (payout unit + fees). */
export type MarketSettlementPolicy = Readonly<{
  /** Currently only Φ is supported in SigilMarkets. */
  unit: "phi";
  /**
   * Redemption value per 1 share on a win.
   * Typically ONE_PHI_MICRO (i.e., 1 Φ per share).
   */
  redeemPerShareMicro: PhiMicro;
  /** Protocol fee on trades/settlement, in basis points. */
  feeBps: Bps;
  /**
   * If true, fees are taken on entry (trade).
   * If false, fees are taken on exit (claim).
   * UI can display differently, but math stays deterministic.
   */
  feeTiming: "entry" | "exit";
}>;

/** Oracle providers are extensible; core set supports multiple resolution styles. */
export type OracleProvider =
  | "sigil-oracle" // native resolution sigils + signatures
  | "committee" // named resolvers (multisig / quorum)
  | "crowd" // dispute/consensus vote
  | "external" // external data referenced by evidence bundle
  | (string & { readonly __oracleProvider?: "custom" });

export type MarketOraclePolicy = Readonly<{
  provider: OracleProvider;
  /** Optional provider-specific id (e.g., committeeId, oracleId). */
  oracleId?: OracleId;
  /**
   * Dispute window in pulses after a proposed resolution is posted.
   * If absent or 0, resolution is final at first posting.
   */
  disputeWindowPulses?: number;
  /**
   * If true, the resolution must include at least one evidence URL/hash pair.
   * (Enforced by verifier, not by UI.)
   */
  evidenceRequired?: boolean;
}>;

/** Human-readable rules for the market (what resolves it, how, and what void means). */
export type MarketRules = Readonly<{
  /** One sentence: what “YES” means. */
  yesCondition: string;
  /** Optional additional clarifications. */
  clarifications?: readonly string[];
  /** Oracle policy for resolving. */
  oracle: MarketOraclePolicy;
  /** Settlement policy for payout/fees. */
  settlement: MarketSettlementPolicy;
  /** Void rules: when it can be voided and how refunds work. */
  voidPolicy: Readonly<{
    /** Allowed if evidence is ambiguous, data unavailable, or market invalid. */
    canVoid: boolean;
    /**
     * Refund behavior for void/cancel:
     * - "refund-stake": return locked stake to vaults
     * - "refund-less-fee": return stake minus fees already taken
     * - "no-refund": allowed only for admin/security events (rare)
     */
    refundMode: "refund-stake" | "refund-less-fee" | "no-refund";
  }>;
}>;

/** Binary mid prices expressed as microΦ per 1 share. */
export type BinaryPricesMicro = Readonly<{
  yes: PriceMicro;
  no: PriceMicro;
}>;

/**
 * Venue = how trading/price discovery works.
 * - amm: automated market maker
 * - parimutuel: pool-split on resolution
 * - clob: central limit order book (optional)
 */
export type MarketVenueKind = "amm" | "parimutuel" | "clob";

/** AMM curve type. */
export type AmmCurve = "cpmm" | "lmsr";

/** AMM internal state (kept minimal; verifiers can interpret deterministically). */
export type AmmState = Readonly<{
  curve: AmmCurve;
  /**
   * Inventory / liquidity representation is curve-specific.
   * Keep both legs as shares to support simple constant-product styles.
   */
  yesInventoryMicro: ShareMicro;
  noInventoryMicro: ShareMicro;
  /** Protocol fee for trades on this market (may mirror settlement.feeBps). */
  feeBps: Bps;
  /**
   * Optional curve parameter, e.g. LMSR liquidity "b" (scaled by ONE_PHI_MICRO).
   * If unused, omit.
   */
  paramMicro?: PhiMicro;
}>;

/** Parimutuel pool state. */
export type ParimutuelState = Readonly<{
  yesPoolMicro: PhiMicro;
  noPoolMicro: PhiMicro;
  feeBps: Bps;
}>;

export type ClobPriceLevel = Readonly<{
  priceMicro: PriceMicro;
  sizeMicro: ShareMicro;
}>;

/** Minimal CLOB state for UI (best bid/ask + optional depth). */
export type ClobState = Readonly<{
  yesBidMicro?: PriceMicro;
  yesAskMicro?: PriceMicro;
  noBidMicro?: PriceMicro;
  noAskMicro?: PriceMicro;
  depthYes?: readonly ClobPriceLevel[];
  depthNo?: readonly ClobPriceLevel[];
  feeBps: Bps;
}>;

/** Discriminated union for trading venue state. */
export type MarketVenueState =
  | Readonly<{ venue: "amm"; amm: AmmState }>
  | Readonly<{ venue: "parimutuel"; pool: ParimutuelState }>
  | Readonly<{ venue: "clob"; clob: ClobState }>;

/** Dynamic state for a binary market. */
export type BinaryMarketState = Readonly<{
  status: MarketStatus;
  /** Venue + its internal state. */
  venueState: MarketVenueState;
  /** Mid prices for UI (microΦ per 1 share). */
  pricesMicro: BinaryPricesMicro;
  /** Aggregate liquidity estimate (microΦ). */
  liquidityMicro?: PhiMicro;
  /** Aggregate volume rolling 24h estimate (microΦ). */
  volume24hMicro?: PhiMicro;
  /** Last pulse this state was updated. */
  updatedPulse: KaiPulse;

  /** Present when status is resolved/voided/canceled. */
  resolution?: MarketResolution;
}>;

/** Static definition for a binary market. */
export type BinaryMarketDefinition = Readonly<{
  id: MarketId;
  kind: "binary";
  slug: MarketSlug;

  /** Short, punchy question (UI headline). */
  question: string;
  /** Optional longer description. */
  description?: string;

  category: MarketCategory;
  tags: readonly string[];

  timing: MarketTiming;
  rules: MarketRules;

  /** Optional UI hinting (images/emoji). */
  iconEmoji?: string;
  heroImageUrl?: string;

  /**
   * Content hash for deterministic identification of the definition payload.
   * (Computed elsewhere; stored here to make tamper evident.)
   */
  definitionHash?: EvidenceHash;
}>;

/** Full market object (definition + dynamic state). */
export type BinaryMarket = Readonly<{
  def: BinaryMarketDefinition;
  state: BinaryMarketState;
}>;

export type Market = BinaryMarket;

export const isBinaryMarket = (m: Market): m is BinaryMarket => m.def.kind === "binary";

/** How the user expresses intent to buy exposure. */
export type OrderType = "market" | "limit";

/** Quote request for a buy (stake -> shares). */
export type MarketQuoteRequest = Readonly<{
  marketId: MarketId;
  side: MarketSide;
  orderType: OrderType;

  /** Amount of microΦ to spend/lock. */
  stakeMicro: PhiMicro;

  /**
   * For limit orders:
   * - YES: max price you're willing to pay (microΦ per 1 share)
   * - NO:  max price you're willing to pay (microΦ per 1 share)
   */
  limitPriceMicro?: PriceMicro;

  /**
   * UI/UX slippage guard (bps).
   * The executor should fail if the realized avg price exceeds this bound.
   */
  maxSlippageBps?: Bps;
}>;

/** Quote result for UI preview and deterministic execution checks. */
export type MarketQuote = Readonly<{
  marketId: MarketId;
  side: MarketSide;

  orderType: OrderType;
  stakeMicro: PhiMicro;

  /** Expected shares to receive (micro-shares). */
  expectedSharesMicro: ShareMicro;

  /** Average execution price (microΦ per 1 share). */
  avgPriceMicro: PriceMicro;

  /** Worst-case price observed in the simulated path (microΦ per 1 share). */
  worstPriceMicro: PriceMicro;

  /** Fee charged (microΦ). */
  feeMicro: PhiMicro;

  /** Total microΦ debited from vault at execution time. */
  totalCostMicro: PhiMicro;

  /** Prices after execution (for UI preview). */
  postPricesMicro?: BinaryPricesMicro;

  /** Slippage estimate in basis points (informational). */
  slippageBps?: Bps;

  /** Pulse at which the quote was computed (for staleness detection). */
  quotedAtPulse: KaiPulse;
}>;

/** Resolution proposal/finalization payload. */
export type MarketResolution = Readonly<{
  marketId: MarketId;
  /** Final outcome. */
  outcome: MarketOutcome;

  /** Pulse when finalization occurred. */
  resolvedPulse: KaiPulse;

  /** Provider + ids used to resolve. */
  oracle: MarketOraclePolicy;

  /** Optional evidence bundle (URLs and/or hashes). */
  evidence?: Readonly<{
    urls?: readonly string[];
    hashes?: readonly EvidenceHash[];
    /** Optional human summary. */
    summary?: string;
  }>;

  /**
   * If disputes are supported:
   * - proposedPulse: when the outcome was proposed
   * - finalPulse: when it became final (after dispute window)
   */
  dispute?: Readonly<{
    proposedPulse: KaiPulse;
    finalPulse: KaiPulse;
    /** Optional dispute count / quorum result (provider-specific). */
    meta?: Readonly<Record<string, string>>;
  }>;
}>;

/** Activity events for market timelines (feed/room). */
export type MarketActivityEvent =
  | Readonly<{
      type: "market-created";
      marketId: MarketId;
      atPulse: KaiPulse;
    }>
  | Readonly<{
      type: "trade";
      marketId: MarketId;
      side: MarketSide;
      stakeMicro: PhiMicro;
      sharesMicro: ShareMicro;
      avgPriceMicro: PriceMicro;
      atPulse: KaiPulse;
      /** Optional: include for personalized UI; omit for public feed if desired. */
      vaultId?: VaultId;
      lockId?: LockId;
    }>
  | Readonly<{
      type: "market-closed";
      marketId: MarketId;
      atPulse: KaiPulse;
    }>
  | Readonly<{
      type: "resolution-proposed";
      marketId: MarketId;
      outcome: MarketOutcome;
      atPulse: KaiPulse;
    }>
  | Readonly<{
      type: "market-resolved";
      marketId: MarketId;
      outcome: MarketOutcome;
      atPulse: KaiPulse;
    }>;
