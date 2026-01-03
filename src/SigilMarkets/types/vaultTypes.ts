// SigilMarkets/types/vaultTypes.ts
/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — vaultTypes (normative)
 *
 * Vault = value layer bound to an Identity Sigil (NOT the identity itself).
 * - A user "inhales" an Identity Sigil (SVG) to authenticate.
 * - We derive a VaultId deterministically from identity artifacts elsewhere.
 * - The vault holds spendable Φ and locks Φ into escrow for open positions.
 *
 * All values are stored as integer microΦ (bigint).
 * JSON serialization uses decimal strings (no bigint in JSON).
 */

import type {
  Brand,
  KaiMoment,
  KaiPulse,
  LockId,
  MicroDecimalString,
  PhiMicro,
  VaultId,
} from "./marketTypes";

/** Hash of an SVG payload (sha256 hex string, etc.). */
export type SvgHash = Brand<string, "SvgHash">;
export const asSvgHash = (v: string): SvgHash => v as SvgHash;

/** User public key / identifier used across Phi Network. */
export type UserPhiKey = Brand<string, "UserPhiKey">;
export const asUserPhiKey = (v: string): UserPhiKey => v as UserPhiKey;

/** Deterministic Kai signature (hex string). */
export type KaiSignature = Brand<string, "KaiSignature">;
export const asKaiSignature = (v: string): KaiSignature => v as KaiSignature;

/** Optional ZK proof reference (opaque id or hash). */
export type ZkProofRef = Brand<string, "ZkProofRef">;
export const asZkProofRef = (v: string): ZkProofRef => v as ZkProofRef;

/** A stable identifier for a specific identity sigil artifact. */
export type IdentitySigilId = Brand<string, "IdentitySigilId">;
export const asIdentitySigilId = (v: string): IdentitySigilId => v as IdentitySigilId;

export type VaultStatus = "active" | "frozen";
export const isVaultStatus = (v: unknown): v is VaultStatus => v === "active" || v === "frozen";

/**
 * Lock status:
 * - locked: escrowed for an open position
 * - released: released back to spendable (e.g. cancel/failed trade)
 * - burned: removed from vault (loss or fee burn)
 * - paid: transferred out to settlement pool / winners
 * - refunded: returned due to VOID/CANCEL resolution
 */
export type VaultLockStatus = "locked" | "released" | "burned" | "paid" | "refunded";
export const isVaultLockStatus = (v: unknown): v is VaultLockStatus =>
  v === "locked" || v === "released" || v === "burned" || v === "paid" || v === "refunded";

/** Lock reason for UI explanation. */
export type VaultLockReason =
  | "position-open"
  | "position-claim"
  | "position-loss"
  | "position-refund"
  | "trade-failed"
  | "admin"
  | (string & { readonly __vaultLockReason?: "custom" });

/** A lock inside a vault. */
export type VaultLock = Readonly<{
  lockId: LockId;
  status: VaultLockStatus;

  /** Why this lock exists / transitioned. */
  reason: VaultLockReason;

  /** Amount locked (microΦ). */
  amountMicro: PhiMicro;

  /** Pulses for provenance. */
  createdAt: KaiMoment;
  updatedPulse: KaiPulse;

  /** Optional linkages. */
  marketId?: string;
  positionId?: string;

  /** Optional note for UI. */
  note?: string;
}>;

/**
 * Deterministic internal vault record.
 * - spendable: can be used for new wagers
 * - locked: sum of locks in status=locked (escrowed)
 * - total: spendable + locked (for UI)
 */
export type VaultRecord = Readonly<{
  vaultId: VaultId;

  /** Identity binding (who controls this vault). */
  owner: Readonly<{
    userPhiKey: UserPhiKey;
    kaiSignature: KaiSignature;

    /** Optional stronger uniqueness proof reference. */
    zkProofRef?: ZkProofRef;

    /** Identity sigil info (for UI & rehydration). */
    identitySigil?: Readonly<{
      sigilId?: IdentitySigilId;
      svgHash: SvgHash;
      url?: string;
      canonicalHash?: string;
      valuePhiMicro?: PhiMicro;
      availablePhiMicro?: PhiMicro;
      lastValuedPulse?: KaiPulse;
    }>;
  }>;

  status: VaultStatus;

  /** Balances (microΦ). */
  spendableMicro: PhiMicro;
  lockedMicro: PhiMicro;

  /** Lock set (escrow). */
  locks: readonly VaultLock[];

  /** Optional streak / prestige stats (computed, but stored for fast UI). */
  stats?: Readonly<{
    winStreak: number;
    lossStreak: number;
    totalWins: number;
    totalLosses: number;
    totalClaims: number;
    totalRefunds: number;
    /** Last outcome pulse for animation timing. */
    lastOutcomePulse?: KaiPulse;
  }>;

  /** Pulses for ordering. */
  createdPulse: KaiPulse;
  updatedPulse: KaiPulse;
}>;

/**
 * JSON-serializable form of VaultRecord (microΦ bigint -> decimal strings).
 */
export type SerializedVaultRecord = Readonly<{
  vaultId: VaultId;

  owner: Readonly<{
    userPhiKey: UserPhiKey;
    kaiSignature: KaiSignature;
    zkProofRef?: ZkProofRef;

    identitySigil?: Readonly<{
      sigilId?: IdentitySigilId;
      svgHash: SvgHash;
      url?: string;
      canonicalHash?: string;
      valuePhiMicro?: MicroDecimalString;
      availablePhiMicro?: MicroDecimalString;
      lastValuedPulse?: KaiPulse;
    }>;
  }>;

  status: VaultStatus;

  spendableMicro: MicroDecimalString;
  lockedMicro: MicroDecimalString;

  locks: readonly Readonly<{
    lockId: LockId;
    status: VaultLockStatus;
    reason: VaultLockReason;
    amountMicro: MicroDecimalString;
    createdAt: KaiMoment;
    updatedPulse: KaiPulse;
    marketId?: string;
    positionId?: string;
    note?: string;
  }>;

  stats?: Readonly<{
    winStreak: number;
    lossStreak: number;
    totalWins: number;
    totalLosses: number;
    totalClaims: number;
    totalRefunds: number;
    lastOutcomePulse?: KaiPulse;
  }>;

  createdPulse: KaiPulse;
  updatedPulse: KaiPulse;
}>;

/** Deposit/withdraw intent for UI + execution layer. */
export type VaultValueMoveKind = "deposit" | "withdraw";

export type VaultValueMoveRequest = Readonly<{
  vaultId: VaultId;
  kind: VaultValueMoveKind;

  /** Amount to move (microΦ). */
  amountMicro: PhiMicro;

  /** Kai pulse when user initiated. */
  initiatedPulse: KaiPulse;

  /** Optional external references (payment, QR transfer, etc.). */
  meta?: Readonly<Record<string, string>>;
}>;

export type VaultValueMoveResult = Readonly<{
  vaultId: VaultId;
  kind: VaultValueMoveKind;

  /** Pulse when applied. */
  appliedPulse: KaiPulse;

  /** New balances. */
  spendableMicro: PhiMicro;
  lockedMicro: PhiMicro;
}>;

/**
 * Vault Sigil payload embedded in a rendered Vault Sigil (optional UI artifact).
 * This is NOT required for functionality, but enables share/print proof of value state.
 * All micros as decimal strings for JSON.
 */
export type VaultSigilPayloadV1 = Readonly<{
  v: "SM-VAULT-1";
  kind: "vault";

  vaultId: VaultId;

  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;

  /** Balances snapshot at time of mint. */
  spendableMicro: MicroDecimalString;
  lockedMicro: MicroDecimalString;

  /** Optional prestige stats snapshot. */
  stats?: Readonly<{
    winStreak: number;
    totalWins: number;
    totalLosses: number;
  }>;

  /** Kai moment the snapshot was minted. */
  mintedAt: KaiMoment;

  /** Identity sigil hash used to bind this vault. */
  identitySvgHash: SvgHash;

  /** Optional UI labels. */
  label?: string;
}>;

/** Reference to a minted Vault Sigil artifact. */
export type VaultSigilArtifact = Readonly<{
  svgHash: SvgHash;
  url?: string;
  payload: VaultSigilPayloadV1;
}>;

/** Helper interfaces for type-safe vault querying. */
export type VaultSnapshot = Readonly<{
  vaultId: VaultId;
  status: VaultStatus;
  spendableMicro: PhiMicro;
  lockedMicro: PhiMicro;
  updatedPulse: KaiPulse;
}>;

/** Guard utilities (minimal). */
export const isUserPhiKey = (v: unknown): v is UserPhiKey => typeof v === "string" && v.length > 0;
export const isKaiSignature = (v: unknown): v is KaiSignature => typeof v === "string" && v.length > 0;
export const isSvgHash = (v: unknown): v is SvgHash => typeof v === "string" && v.length > 0;
// vaultTypes.ts

// If you already have this type, make sure it's exported (not just `type ...`)
export type MicroDecimalString = string & {
  readonly __brand: "MicroDecimalString";
};

// Add this if missing, or export it if it already exists
export const asMicroDecimalString = (v: string): MicroDecimalString => {
  const s = v.trim();

  // non-negative integer decimal string, canonical (no leading zeros except "0")
  if (!/^(0|[1-9]\d*)$/.test(s)) {
    throw new Error(`invalid MicroDecimalString: ${v}`);
  }

  return s as MicroDecimalString;
};
