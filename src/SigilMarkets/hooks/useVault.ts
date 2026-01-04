// SigilMarkets/hooks/useVault.ts
"use client";

import { useCallback, useMemo } from "react";
import type { KaiPulse, LockId, PhiMicro, VaultId } from "../types/marketTypes";
import type { VaultRecord, VaultLock, VaultLockReason, VaultLockStatus } from "../types/vaultTypes";
import { useActiveVault, useSigilMarketsVaultStore, useVaultById } from "../state/vaultStore";
import { useSigilMarketsUi } from "../state/uiStore";
import { recordSigilLedgerEvent } from "../../utils/sigilLedgerRegistry";
import { momentFromPulse } from "../../utils/kai_pulse";

export type UseVaultResult = Readonly<{
  vault: VaultRecord | null;
  vaultId: VaultId | null;

  status: "missing" | "ready";
  isFrozen: boolean;

  spendableMicro: PhiMicro;
  lockedMicro: PhiMicro;

  lockedCount: number;
  locks: readonly VaultLock[];

  /** Convenience for UI. */
  hasSpendable: boolean;
  hasLocked: boolean;
}>;

const countLocked = (locks: readonly VaultLock[]): number => locks.reduce((n, l) => (l.status === "locked" ? n + 1 : n), 0);

const rootSigilIdFromVault = (vault: VaultRecord): string | null => {
  const identity = vault.owner.identitySigil;
  if (!identity) return null;
  return (
    (identity.sigilId as unknown as string | undefined) ??
    (identity.canonicalHash as unknown as string | undefined) ??
    (identity.svgHash as unknown as string | undefined) ??
    null
  );
};

export const useVault = (vaultId?: VaultId | null): UseVaultResult => {
  const active = useActiveVault();

  // React hooks must be called unconditionally.
  // When no vaultId is provided, we still call useVaultById with a safe sentinel/fallback.
  const lookupId: VaultId = (vaultId ?? active?.vaultId ?? ("__none__" as unknown as VaultId));
  const byId = useVaultById(lookupId);

  const vault = vaultId ? byId : active;

  return useMemo<UseVaultResult>(() => {
    if (!vault) {
      return {
        vault: null,
        vaultId: vaultId ?? null,
        status: "missing",
        isFrozen: false,
        spendableMicro: 0n,
        lockedMicro: 0n,
        lockedCount: 0,
        locks: [],
        hasSpendable: false,
        hasLocked: false,
      };
    }

    const spendableMicro = vault.spendableMicro;
    const lockedMicro = vault.lockedMicro;
    const lockedCount = countLocked(vault.locks);

    return {
      vault,
      vaultId: vault.vaultId,
      status: "ready",
      isFrozen: vault.status === "frozen",
      spendableMicro,
      lockedMicro,
      lockedCount,
      locks: vault.locks,
      hasSpendable: spendableMicro > 0n,
      hasLocked: lockedMicro > 0n,
    };
  }, [vault, vaultId]);
};

export const useVaultActions = (): Readonly<{
  activeVault: VaultRecord | null;
  setActiveVault: (vaultId: VaultId | null) => void;

  deposit: (vaultId: VaultId, amountMicro: PhiMicro, atPulse: KaiPulse) => void;
  withdraw: (vaultId: VaultId, amountMicro: PhiMicro, atPulse: KaiPulse) => void;

  openLock: (req: Readonly<{
    vaultId: VaultId;
    lockId: LockId;
    amountMicro: PhiMicro;
    reason: VaultLockReason;
    createdAt: { pulse: number; beat: number; stepIndex: number };
    updatedPulse: KaiPulse;
    marketId?: string;
    positionId?: string;
    note?: string;
  }>) => void;

  transitionLock: (req: Readonly<{
    vaultId: VaultId;
    lockId: LockId;
    toStatus: VaultLockStatus;
    reason: VaultLockReason;
    updatedPulse: KaiPulse;
    note?: string;
  }>) => void;
}> => {
  const { state, actions } = useSigilMarketsVaultStore();
  const { actions: ui } = useSigilMarketsUi();

  const activeVault = state.activeVaultId ? (state.byId[state.activeVaultId as unknown as string] ?? null) : null;

  const setActiveVault = useCallback(
    (vaultId: VaultId | null) => {
      actions.setActiveVault(vaultId);
    },
    [actions],
  );

  const deposit = useCallback(
    (vaultId: VaultId, amountMicro: PhiMicro, atPulse: KaiPulse) => {
      const res = actions.moveValue({ vaultId, kind: "deposit", amountMicro, atPulse });
      if (!res.ok) ui.toast("error", "Deposit failed", res.error);
      else {
        ui.toast("success", "Deposited", undefined, { atPulse });
        const vault = res.value;
        const rootId = rootSigilIdFromVault(vault);
        if (rootId && vault.owner.identitySigil) {
          void recordSigilLedgerEvent({
            rootSigilId: rootId,
            rootSvgHash: vault.owner.identitySigil.svgHash,
            kind: "DEPOSIT",
            kaiMoment: momentFromPulse(atPulse),
            deltaPhiMicro: String(amountMicro),
            resultingBalanceMicro: String(vault.spendableMicro),
            refId: `${String(vaultId)}:${String(amountMicro)}`,
            refs: { vaultId: String(vaultId) },
          });
        }
      }
    },
    [actions, ui],
  );

  const withdraw = useCallback(
    (vaultId: VaultId, amountMicro: PhiMicro, atPulse: KaiPulse) => {
      const res = actions.moveValue({ vaultId, kind: "withdraw", amountMicro, atPulse });
      if (!res.ok) ui.toast("error", "Withdraw failed", res.error);
      else {
        ui.toast("success", "Withdrew", undefined, { atPulse });
        const vault = res.value;
        const rootId = rootSigilIdFromVault(vault);
        if (rootId && vault.owner.identitySigil) {
          void recordSigilLedgerEvent({
            rootSigilId: rootId,
            rootSvgHash: vault.owner.identitySigil.svgHash,
            kind: "WITHDRAW",
            kaiMoment: momentFromPulse(atPulse),
            deltaPhiMicro: `-${String(amountMicro)}`,
            resultingBalanceMicro: String(vault.spendableMicro),
            refId: `${String(vaultId)}:${String(amountMicro)}`,
            refs: { vaultId: String(vaultId) },
          });
        }
      }
    },
    [actions, ui],
  );

  const openLock = useCallback(
    (req: Readonly<{
      vaultId: VaultId;
      lockId: LockId;
      amountMicro: PhiMicro;
      reason: VaultLockReason;
      createdAt: { pulse: number; beat: number; stepIndex: number };
      updatedPulse: KaiPulse;
      marketId?: string;
      positionId?: string;
      note?: string;
    }>) => {
      const res = actions.openLock(req);
      if (!res.ok) ui.toast("error", "Lock failed", res.error, { atPulse: req.updatedPulse });
      else {
        const vault = res.value;
        const rootId = rootSigilIdFromVault(vault);
        if (rootId && vault.owner.identitySigil) {
          void recordSigilLedgerEvent({
            rootSigilId: rootId,
            rootSvgHash: vault.owner.identitySigil.svgHash,
            kind: "LOCK",
            kaiMoment: req.createdAt,
            deltaPhiMicro: `-${String(req.amountMicro)}`,
            resultingBalanceMicro: String(vault.spendableMicro),
            refId: String(req.lockId),
            refs: {
              vaultId: String(req.vaultId),
              lockId: String(req.lockId),
              marketId: req.marketId,
              positionId: req.positionId,
            },
          });
        }
      }
    },
    [actions, ui],
  );

  const transitionLock = useCallback(
    (req: Readonly<{
      vaultId: VaultId;
      lockId: LockId;
      toStatus: VaultLockStatus;
      reason: VaultLockReason;
      updatedPulse: KaiPulse;
      note?: string;
    }>) => {
      const res = actions.transitionLock(req);
      if (!res.ok) ui.toast("error", "Lock update failed", res.error, { atPulse: req.updatedPulse });
      else if (req.toStatus === "released" || req.toStatus === "refunded") {
        const vault = res.value;
        const rootId = rootSigilIdFromVault(vault);
        if (rootId && vault.owner.identitySigil) {
          const lock = vault.locks.find((l) => l.lockId === req.lockId);
          const delta = lock ? String(lock.amountMicro) : "0";
          void recordSigilLedgerEvent({
            rootSigilId: rootId,
            rootSvgHash: vault.owner.identitySigil.svgHash,
            kind: "UNLOCK",
            kaiMoment: momentFromPulse(req.updatedPulse),
            deltaPhiMicro: delta,
            resultingBalanceMicro: String(vault.spendableMicro),
            refId: String(req.lockId),
            refs: {
              vaultId: String(req.vaultId),
              lockId: String(req.lockId),
            },
          });
        }
      }
    },
    [actions, ui],
  );

  return {
    activeVault,
    setActiveVault,
    deposit,
    withdraw,
    openLock,
    transitionLock,
  };
};
