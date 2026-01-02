import type { Brand, KaiMoment, KaiPulse, LockId, PhiMicro, VaultId } from "./marketTypes";

export interface VaultSnapshot {
  id: string;
  label: string;
  balance: number;
  streak: number;
  apy: number;
  lastUpdated: string;
}

export type UserPhiKey = Brand<string, "UserPhiKey">;
export const asUserPhiKey = (v: string): UserPhiKey => v as UserPhiKey;

export type KaiSignature = Brand<string, "KaiSignature">;
export const asKaiSignature = (v: string): KaiSignature => v as KaiSignature;

export type SvgHash = Brand<string, "SvgHash">;
export const asSvgHash = (v: string): SvgHash => v as SvgHash;

export type ZkProofRef = Brand<string, "ZkProofRef">;
export const asZkProofRef = (v: string): ZkProofRef => v as ZkProofRef;

export type MicroDecimalString = Brand<string, "MicroDecimalString">;
export const asMicroDecimalString = (v: string): MicroDecimalString => v as MicroDecimalString;

export type VaultStatus = "active" | "frozen";

export type VaultLockStatus = "locked" | "released" | "burned" | "paid" | "refunded";

export type VaultLockReason = "position-open";
export const isVaultLockReason = (v: unknown): v is VaultLockReason => v === "position-open";

export type IdentitySigilRef = Readonly<{
  sigilId?: string;
  svgHash: SvgHash;
  url?: string;
}>;

export type VaultOwner = Readonly<{
  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;
  zkProofRef?: ZkProofRef;
  identitySigil?: IdentitySigilRef;
}>;

export type VaultLock = Readonly<{
  lockId: LockId;
  status: VaultLockStatus;
  reason: VaultLockReason;
  amountMicro: PhiMicro;
  createdAt: KaiMoment;
  updatedPulse: KaiPulse;
  marketId?: string;
  positionId?: string;
  note?: string;
}>;

export type VaultStats = Readonly<{
  winStreak: number;
  lossStreak: number;
  totalWins: number;
  totalLosses: number;
  totalClaims: number;
  totalRefunds: number;
  lastOutcomePulse?: KaiPulse;
}>;

export type VaultRecord = Readonly<{
  vaultId: VaultId;
  owner: VaultOwner;
  status: VaultStatus;
  spendableMicro: PhiMicro;
  lockedMicro: PhiMicro;
  locks: readonly VaultLock[];
  stats?: VaultStats;
  createdPulse: KaiPulse;
  updatedPulse: KaiPulse;
}>;

export type SerializedVaultRecord = Readonly<{
  vaultId: VaultId;
  owner: VaultOwner;
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
  }>[];
  stats?: VaultStats;
  createdPulse: KaiPulse;
  updatedPulse: KaiPulse;
}>;
