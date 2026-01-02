// SigilMarkets/types/sigilPositionTypes.ts
/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — sigilPositionTypes (normative)
 *
 * A "Position" is the wager receipt:
 * - It can become inert (lose), refundable (void/cancel), or claimable (win).
 * - It is represented as BOTH:
 *   (1) an internal deterministic record (bigint micros),
 *   (2) a portable Position Sigil payload (JSON-in-SVG metadata).
 *
 * IMPORTANT:
 * - The user's Identity Sigil remains usable forever.
 * - The Position Sigil is what "dies" or "explodes" economically.
 */

import type {
  Brand,
  EvidenceHash,
  KaiMoment,
  KaiPulse,
  LockId,
  MarketId,
  MarketOutcome,
  MarketSide,
  PhiMicro,
  PriceMicro,
  ShareMicro,
  VaultId,
} from "./marketTypes";

import type { KaiSignature, MicroDecimalString, SvgHash, UserPhiKey } from "./vaultTypes";
export type { MicroDecimalString } from "./vaultTypes";
export { asMicroDecimalString } from "./vaultTypes";

/** Position id (unique within the user's local store; may also be globally referenced). */
export type PositionId = Brand<string, "PositionId">;
export const asPositionId = (v: string): PositionId => v as PositionId;

/** Position Sigil id (stable id for the minted portable artifact). */
export type PositionSigilId = Brand<string, "PositionSigilId">;
export const asPositionSigilId = (v: string): PositionSigilId => v as PositionSigilId;

/** A deterministic event id for position lifecycle events (optional). */
export type PositionEventId = Brand<string, "PositionEventId">;
export const asPositionEventId = (v: string): PositionEventId => v as PositionEventId;

export type PositionVenueKind = "amm" | "parimutuel" | "clob";

/**
 * How this position should pay out at resolution time.
 * - amm-shares: redeem winning shares at redeemPerShareMicro
 * - parimutuel: payout computed from pools
 * - void-refund: stake refunded per market rules
 */
export type PositionPayoutModel = "amm-shares" | "parimutuel" | "void-refund";

/**
 * Position status:
 * - open: market not resolved yet
 * - claimable: winning outcome known; user can claim to vault
 * - claimed: claim executed (vault credited)
 * - lost: losing outcome; position becomes inert (0)
 * - refundable: void/cancel outcome; user can refund stake
 * - refunded: refund executed
 */
export type PositionStatus = "open" | "claimable" | "claimed" | "lost" | "refundable" | "refunded";
export const isPositionStatus = (v: unknown): v is PositionStatus =>
  v === "open" ||
  v === "claimable" ||
  v === "claimed" ||
  v === "lost" ||
  v === "refundable" ||
  v === "refunded";

/**
 * A position is always tied to a vault lock.
 * The lock is the escrowed Φ that powers the position.
 */
export type PositionLockRef = Readonly<{
  vaultId: VaultId;
  lockId: LockId;
  /** Amount originally locked into escrow (microΦ). */
  lockedStakeMicro: PhiMicro;
}>;

/**
 * Execution snapshot at entry.
 * Keep enough detail to:
 * - render the user's receipt,
 * - compute max payout (for AMM shares),
 * - validate "quote vs executed" bounds.
 */
export type PositionEntrySnapshot = Readonly<{
  /** Market side purchased. */
  side: MarketSide;
  /** Stake debited (microΦ) excluding fees if fees are on entry. */
  stakeMicro: PhiMicro;
  /** Fee charged at entry (microΦ). */
  feeMicro: PhiMicro;
  /** Total cost debited at execution time (microΦ). */
  totalCostMicro: PhiMicro;

  /** Shares received (micro-shares). */
  sharesMicro: ShareMicro;

  /** Average execution price (microΦ per 1 share). */
  avgPriceMicro: PriceMicro;

  /** Worst observed price in the execution path (microΦ per 1 share). */
  worstPriceMicro: PriceMicro;

  /** Venue at execution time. */
  venue: PositionVenueKind;

  /** Pulse moment the execution occurred. */
  openedAt: KaiMoment;

  /** Optional definition hash snapshot (tamper-evident linking to market definition). */
  marketDefinitionHash?: EvidenceHash;
}>;

/** Resolution snapshot as applied to a position. */
export type PositionResolutionSnapshot = Readonly<{
  /** Market outcome (YES/NO/VOID). */
  outcome: MarketOutcome;
  /** Pulse when the market finalized. */
  resolvedPulse: KaiPulse;

  /** If YES/NO, whether this position is a winner. */
  isWinner?: boolean;

  /** If VOID, whether this position is refundable. */
  isRefundable?: boolean;

  /** Optional evidence hashes or resolution signature bundle link. */
  evidenceHashes?: readonly EvidenceHash[];
}>;

/**
 * Deterministic internal position record (micros as bigint).
 * This is what stores and state transitions operate on.
 */
export type PositionRecord = Readonly<{
  id: PositionId;
  marketId: MarketId;

  /** Lock reference powering this position. */
  lock: PositionLockRef;

  /** Entry snapshot (receipt). */
  entry: PositionEntrySnapshot;

  /** Payout model for settlement. */
  payoutModel: PositionPayoutModel;

  /** Lifecycle status. */
  status: PositionStatus;

  /** Present after resolution is known. */
  resolution?: PositionResolutionSnapshot;

  /** Present after claim/refund executes. */
  settlement?: Readonly<{
    /** Pulse when claim/refund executed. */
    settledPulse: KaiPulse;
    /** Amount credited back to the vault (microΦ). */
    creditedMicro: PhiMicro;
    /** Amount burned/transferred away from this vault (microΦ). */
    debitedMicro: PhiMicro;
    /** Optional note (for UI). */
    note?: string;
  }>;

  /** Portable Position Sigil (if minted). */
  sigil?: PositionSigilArtifact;

  /** Last update pulse for store ordering. */
  updatedPulse: KaiPulse;
}>;

/**
 * JSON-serializable form of a PositionRecord for persistence.
 * bigint micros are encoded as decimal strings.
 */
export type SerializedPositionRecord = Readonly<{
  id: PositionId;
  marketId: MarketId;

  lock: Readonly<{
    vaultId: VaultId;
    lockId: LockId;
    lockedStakeMicro: MicroDecimalString;
  }>;

  entry: Readonly<{
    side: MarketSide;
    stakeMicro: MicroDecimalString;
    feeMicro: MicroDecimalString;
    totalCostMicro: MicroDecimalString;

    sharesMicro: MicroDecimalString;
    avgPriceMicro: MicroDecimalString;
    worstPriceMicro: MicroDecimalString;

    venue: PositionVenueKind;
    openedAt: KaiMoment;

    marketDefinitionHash?: EvidenceHash;
  }>;

  payoutModel: PositionPayoutModel;
  status: PositionStatus;

  resolution?: Readonly<{
    outcome: MarketOutcome;
    resolvedPulse: KaiPulse;
    isWinner?: boolean;
    isRefundable?: boolean;
    evidenceHashes?: readonly EvidenceHash[];
  }>;

  settlement?: Readonly<{
    settledPulse: KaiPulse;
    creditedMicro: MicroDecimalString;
    debitedMicro: MicroDecimalString;
    note?: string;
  }>;

  sigil?: PositionSigilArtifact;

  updatedPulse: KaiPulse;
}>;

/**
 * Position Sigil payload embedded into the minted SVG.
 * NOTE: all micro amounts are strings to keep payload JSON-safe.
 */
export type PositionSigilPayloadV1 = Readonly<{
  v: "SM-POS-1";
  kind: "position";

  /** Deterministic identity binding (who minted it). */
  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;

  /** Market binding. */
  marketId: MarketId;
  positionId: PositionId;

  /** Entry details. */
  side: MarketSide;

  /** Amount locked (microΦ, decimal string). */
  lockedStakeMicro: MicroDecimalString;

  /** Shares received (microShares, decimal string). */
  sharesMicro: MicroDecimalString;

  /** Average price paid (microΦ per 1 share, decimal string). */
  avgPriceMicro: MicroDecimalString;

  /** Worst observed price paid (microΦ per 1 share, decimal string). */
  worstPriceMicro: MicroDecimalString;

  /** Fee charged at entry (microΦ, decimal string). */
  feeMicro: MicroDecimalString;

  /** Total cost debited at entry (microΦ, decimal string). */
  totalCostMicro: MicroDecimalString;

  /** Vault lock reference. */
  vaultId: VaultId;
  lockId: LockId;

  /** Kai moment it was opened. */
  openedAt: KaiMoment;

  /** Venue at entry. */
  venue: PositionVenueKind;

  /** Optional tamper-evident linking to market definition. */
  marketDefinitionHash?: EvidenceHash;

  /** Optional, filled after resolution/claim by reminting a "finalized" artifact. */
  resolution?: Readonly<{
    outcome: MarketOutcome;
    resolvedPulse: KaiPulse;
    status: PositionStatus;
    creditedMicro?: MicroDecimalString;
    debitedMicro?: MicroDecimalString;
  }>;

  /** Optional UI labels. */
  label?: string;
  note?: string;
}>;

/** A minted Position Sigil artifact reference. */
export type PositionSigilArtifact = Readonly<{
  /** Stable artifact id (local). */
  sigilId: PositionSigilId;

  /** Hash of the SVG bytes (sha256 hex or similar). */
  svgHash: SvgHash;

  /**
   * Optional URL where the sigil is accessible (local object URL, blob URL, or remote).
   * This module treats it as an opaque string.
   */
  url?: string;

  /** Embedded payload (v1). */
  payload: PositionSigilPayloadV1;
}>;

/**
 * Request to mint a Position Sigil.
 * This is the interface between the trading flow and sigil rendering.
 */
export type MintPositionSigilRequest = Readonly<{
  positionId: PositionId;
  marketId: MarketId;
  lock: PositionLockRef;
  entry: PositionEntrySnapshot;

  /** Identity binding. */
  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;

  /** Optional label/note for UI. */
  label?: string;
  note?: string;
}>;

export type MintPositionSigilResult = Readonly<{
  sigil: PositionSigilArtifact;
}>;

/**
 * Claim/refund intent:
 * - claim: winner payout into the vault
 * - refund: void/cancel refund into the vault
 */
export type PositionSettleKind = "claim" | "refund";

export type SettlePositionRequest = Readonly<{
  positionId: PositionId;
  kind: PositionSettleKind;

  /** Caller binding (must match position's vault/user in the verifier). */
  vaultId: VaultId;

  /** Kai pulse when the user initiated the claim (for UI + ordering). */
  initiatedPulse: KaiPulse;
}>;

export type SettlePositionResult = Readonly<{
  positionId: PositionId;
  kind: PositionSettleKind;

  /** Pulse when settlement executed. */
  settledPulse: KaiPulse;

  /** Credited to vault (microΦ). */
  creditedMicro: PhiMicro;

  /** Debited from vault (microΦ). */
  debitedMicro: PhiMicro;

  /** New status after settlement. */
  status: PositionStatus;
}>;

/**
 * Position lifecycle events (for reconstructing store state deterministically).
 * These are internal to SigilMarkets and can be persisted as an append-only log.
 */
export type PositionEvent =
  | Readonly<{
      id: PositionEventId;
      type: "position-opened";
      atPulse: KaiPulse;
      position: PositionRecord;
    }>
  | Readonly<{
      id: PositionEventId;
      type: "position-updated";
      atPulse: KaiPulse;
      positionId: PositionId;
      patch: Readonly<{
        status?: PositionStatus;
        resolution?: PositionResolutionSnapshot | null;
        settlement?: PositionRecord["settlement"] | null;
        sigil?: PositionSigilArtifact | null;
        updatedPulse: KaiPulse;
      }>;
    }>
  | Readonly<{
      id: PositionEventId;
      type: "position-removed";
      atPulse: KaiPulse;
      positionId: PositionId;
    }>;
