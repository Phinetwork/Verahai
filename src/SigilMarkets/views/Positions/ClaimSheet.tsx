// SigilMarkets/views/Positions/ClaimSheet.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { KaiMoment, PhiMicro } from "../../types/marketTypes";
import type { PositionRecord } from "../../types/sigilPositionTypes";
import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro, formatSharesMicro } from "../../utils/format";
import { payoutForShares } from "../../utils/math";

import { useSigilMarketsUi } from "../../state/uiStore";
import { useActiveVault, useSigilMarketsVaultStore } from "../../state/vaultStore";
import { useSigilMarketsPositionStore } from "../../state/positionStore";
import { useHaptics } from "../../hooks/useHaptics";
import { useSfx } from "../../hooks/useSfx";

export type ClaimSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;
  position: PositionRecord;
  now: KaiMoment;
}>;

export const ClaimSheet = (props: ClaimSheetProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const { actions: vault } = useSigilMarketsVaultStore();
  const { actions: positions } = useSigilMarketsPositionStore();
  const activeVault = useActiveVault();
  const haptics = useHaptics();
  const sfx = useSfx();

  const p = props.position;

  const canClaim = p.status === "claimable";
  const canRefund = p.status === "refundable";

  const isActionable = canClaim || canRefund;

  const title = canRefund ? "Refund" : "Claim";

  const stakeLabel = useMemo(() => formatPhiMicro(p.entry.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }), [p.entry.stakeMicro]);
  const sharesLabel = useMemo(() => formatSharesMicro(p.entry.sharesMicro, { maxDecimals: 2 }), [p.entry.sharesMicro]);

  const expectedPayout = useMemo(() => {
    if (!canClaim) return 0n as PhiMicro;
    return payoutForShares(p.entry.sharesMicro);
  }, [canClaim, p.entry.sharesMicro]);

  const payoutLabel = useMemo(() => formatPhiMicro(expectedPayout, { withUnit: true, maxDecimals: 6, trimZeros: true }), [expectedPayout]);

  const [loading, setLoading] = useState(false);

  const apply = (): void => {
    if (!isActionable) return;
    if (!activeVault || activeVault.vaultId !== p.lock.vaultId) {
      ui.toast("error", "Not authorized", "Active vault does not match this position.");
      return;
    }

    setLoading(true);

    // Transition lock in vault
    if (canRefund) {
      vault.transitionLock({
        vaultId: p.lock.vaultId,
        lockId: p.lock.lockId,
        toStatus: "refunded",
        reason: "position-refund",
        updatedPulse: props.now.pulse,
        note: "Refunded",
      });

      // Refund returns stake back to spendable via transitionLock (locked->released only).
      // Here, the lock is no longer "locked" anyway; we simulate credit by moving value:
      vault.moveValue({ vaultId: p.lock.vaultId, kind: "deposit", amountMicro: p.entry.stakeMicro, atPulse: props.now.pulse });

      positions.applySettlement({
        positionId: p.id,
        settledPulse: props.now.pulse,
        creditedMicro: p.entry.stakeMicro,
        debitedMicro: 0n as PhiMicro,
        nextStatus: "refunded",
        note: "Refunded",
      });

      ui.toast("success", "Refunded", undefined, { atPulse: props.now.pulse });
      sfx.play("resolve");
      haptics.fire("success");
    } else if (canClaim) {
      // Burn/paid the lock (consumed) then credit payout
      vault.transitionLock({
        vaultId: p.lock.vaultId,
        lockId: p.lock.lockId,
        toStatus: "paid",
        reason: "position-claim",
        updatedPulse: props.now.pulse,
        note: "Claimed",
      });

      vault.moveValue({ vaultId: p.lock.vaultId, kind: "deposit", amountMicro: expectedPayout, atPulse: props.now.pulse });

      positions.applySettlement({
        positionId: p.id,
        settledPulse: props.now.pulse,
        creditedMicro: expectedPayout,
        debitedMicro: p.entry.stakeMicro,
        nextStatus: "claimed",
        note: "Claimed",
      });

      ui.toast("success", "Claimed", payoutLabel, { atPulse: props.now.pulse });
      sfx.play("win");
      haptics.fire("success");
      ui.armConfetti(true);
    }

    setLoading(false);
    props.onClose();
  };

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={title}
      subtitle={canRefund ? "Market voided/canceled. Your stake returns." : "If you won, your shares redeem into your Vault."}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={props.onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={apply}
            disabled={!isActionable || loading}
            loading={loading}
            leftIcon={<Icon name="check" size={14} tone="gold" />}
          >
            {canRefund ? "Refund now" : "Claim now"}
          </Button>
        </div>
      }
    >
      <div className="sm-claim">
        <div className="sm-claim-row">
          <span className="k">Stake</span>
          <span className="v">{stakeLabel}</span>
        </div>
        <div className="sm-claim-row">
          <span className="k">Shares</span>
          <span className="v">{sharesLabel}</span>
        </div>

        <Divider />

        {canClaim ? (
          <div className="sm-claim-row">
            <span className="k">Expected payout</span>
            <span className="v">{payoutLabel}</span>
          </div>
        ) : (
          <div className="sm-claim-row">
            <span className="k">Refund</span>
            <span className="v">{stakeLabel}</span>
          </div>
        )}

        <div className="sm-small" style={{ marginTop: 10 }}>
          This is MVP settlement logic. We will wire full deterministic settlement to your on-ledger resolution keys next.
        </div>
      </div>
    </Sheet>
  );
};
