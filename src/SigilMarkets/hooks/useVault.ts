// SigilMarkets/hooks/useVault.ts
"use client";

import { useCallback, useMemo } from "react";
import type { KaiPulse, LockId, PhiMicro, VaultId } from "../types/marketTypes";
import type { VaultRecord, VaultLock, VaultLockReason, VaultLockStatus } from "../types/vaultTypes";
import { useActiveVault, useSigilMarketsVaultStore, useVaultById } from "../state/vaultStore";
import { useSigilMarketsUi } from "../state/uiStore";

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
      else ui.toast("success", "Deposited", undefined, { atPulse });
    },
    [actions, ui],
  );

  const withdraw = useCallback(
    (vaultId: VaultId, amountMicro: PhiMicro, atPulse: KaiPulse) => {
      const res = actions.moveValue({ vaultId, kind: "withdraw", amountMicro, atPulse });
      if (!res.ok) ui.toast("error", "Withdraw failed", res.error);
      else ui.toast("success", "Withdrew", undefined, { atPulse });
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
