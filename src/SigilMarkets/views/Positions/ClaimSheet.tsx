// SigilMarkets/views/Positions/ClaimSheet.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { KaiMoment, PhiMicro } from "../../types/marketTypes";
import type { ClaimSigilPayloadV1, PositionRecord } from "../../types/sigilPositionTypes";
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
import { mintClaimSigil } from "../../sigils/PositionSigilMint";
import { buildVictoryBundleZip, sanitizeBundleName } from "../../sigils/victoryBundle";
import { download } from "../../../components/VerifierStamper/files";
import { recordSigilLedgerEvent } from "../../../utils/sigilLedgerRegistry";

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

  const title = canRefund ? "Refund" : "Victory";

  const stakeLabel = useMemo(() => formatPhiMicro(p.entry.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }), [p.entry.stakeMicro]);
  const sharesLabel = useMemo(() => formatSharesMicro(p.entry.sharesMicro, { maxDecimals: 2 }), [p.entry.sharesMicro]);

  const expectedPayout = useMemo(() => {
    if (!canClaim) return 0n as PhiMicro;
    return payoutForShares(p.entry.sharesMicro);
  }, [canClaim, p.entry.sharesMicro]);

  const payoutLabel = useMemo(() => formatPhiMicro(expectedPayout, { withUnit: true, maxDecimals: 6, trimZeros: true }), [expectedPayout]);

  const [loading, setLoading] = useState(false);
  const [claimSigil, setClaimSigil] = useState<{
    svgUrl: string;
    svgText: string;
    payload: ClaimSigilPayloadV1;
    svgHash: string;
    canonicalHashHex: string;
    zkSeal: Record<string, unknown>;
  } | null>(null);
  const [bundleBusy, setBundleBusy] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setClaimSigil(null);
      setLoading(false);
      setBundleBusy(false);
    }
  }, [props.open]);

  useEffect(() => {
    return () => {
      if (claimSigil?.svgUrl) {
        URL.revokeObjectURL(claimSigil.svgUrl);
      }
    };
  }, [claimSigil?.svgUrl]);

  const downloadBundle = async (): Promise<void> => {
    if (!claimSigil) return;
    if (bundleBusy) return;
    setBundleBusy(true);
    try {
      const payload = claimSigil.payload;
      const receipt = {
        payload,
        svgHash: claimSigil.svgHash,
        canonicalPayloadHash: claimSigil.canonicalHashHex,
        lineageId: payload.lineageId,
        lineageRootSvgHash: payload.lineageRootSvgHash,
        rootSvgHash: payload.lineageRootSvgHash,
      };
      const proof = claimSigil.zkSeal;
      const payoutDisplay =
        payload.payoutPhiDisplay ||
        formatPhiMicro(BigInt(payload.payoutPhiMicro), { withUnit: true, maxDecimals: 6, trimZeros: true });
      const readme = [
        "Verahai Victory Bundle — Offline Verification",
        "",
        "1) Hash the root identity sigil SVG and confirm it matches lineageRootSvgHash in receipt.json.",
        "2) Recompute lineageId from receipt payload fields (marketId, positionId, outcome, kaiMoment).",
        "3) Derive ΦKey from kaiSignature and confirm it matches userPhiKey in the payload.",
        "4) Verify ZK proof (if present) using proof.json + public inputs.",
        "",
        `Wager: ${stakeLabel}.`,
        `Victory: ${payoutDisplay} (microΦ: ${payload.payoutPhiMicro}).`,
      ].join("\n");

      const base = sanitizeBundleName(
        `verahai-victory-${String(payload.marketId)}-${String(payload.positionId)}-${String(payload.kaiMoment.pulse)}`,
      );

      const zip = await buildVictoryBundleZip({
        svgText: claimSigil.svgText,
        receipt,
        proof,
        readme,
        filenameBase: base,
        output: "blob",
      });

      if (zip.blob) {
        download(zip.blob, `${base}.zip`);
      }
    } finally {
      setBundleBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    if (!isActionable) return;
    if (!activeVault || activeVault.vaultId !== p.lock.vaultId) {
      ui.toast("error", "Not authorized", "Active vault does not match this position.");
      return;
    }

    setLoading(true);
    setClaimSigil(null);

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
        note: "Won sealed",
      });

      vault.moveValue({ vaultId: p.lock.vaultId, kind: "deposit", amountMicro: expectedPayout, atPulse: props.now.pulse });

      positions.applySettlement({
        positionId: p.id,
        settledPulse: props.now.pulse,
        creditedMicro: expectedPayout,
        debitedMicro: p.entry.stakeMicro,
        nextStatus: "claimed",
        note: "Won sealed",
      });

      ui.toast("success", "Won sealed", payoutLabel, { atPulse: props.now.pulse });
      sfx.play("win");
      haptics.fire("success");
      ui.armConfetti(true);
    }

    const payoutMicro =
      canRefund ? p.entry.stakeMicro : canClaim ? expectedPayout : (0n as PhiMicro);
    const claimMoment = props.now;

    const mintRes = await mintClaimSigil(p, activeVault, claimMoment, payoutMicro as unknown as bigint);
    if (mintRes.ok) {
      setClaimSigil({
        svgUrl: mintRes.sigil.url ?? "",
        svgText: mintRes.svgText,
        payload: mintRes.sigil.payload,
        svgHash: String(mintRes.sigil.svgHash),
        canonicalHashHex: mintRes.canonicalHashHex,
        zkSeal: mintRes.zkSeal as unknown as Record<string, unknown>,
      });

      const root = activeVault.owner.identitySigil;
      if (root) {
        const resultingBalance = (activeVault.spendableMicro + payoutMicro) as PhiMicro;
        void recordSigilLedgerEvent({
          rootSigilId:
            (root.sigilId as unknown as string | undefined) ??
            (root.canonicalHash as unknown as string | undefined) ??
            (root.svgHash as unknown as string),
          rootSvgHash: root.svgHash,
          kind: "CLAIM",
          kaiMoment: claimMoment,
          deltaPhiMicro: String(payoutMicro),
          resultingBalanceMicro: String(resultingBalance),
          refId: String(p.id),
          refs: {
            vaultId: String(activeVault.vaultId),
            lockId: String(p.lock.lockId),
            marketId: String(p.marketId),
            positionId: String(p.id),
          },
          hashes: {
            lineageId: mintRes.sigil.payload.lineageId,
            canonicalPayloadHash: mintRes.canonicalHashHex,
          },
        });
      }
    } else {
      ui.toast("error", "Victory sigil failed", mintRes.error, { atPulse: props.now.pulse });
    }

    setLoading(false);
  };

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={title}
      subtitle={canRefund ? "Prophecy voided/canceled. Your stake returns." : "You won. Your shares redeem into your Vault."}
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
            {canRefund ? "Refund now" : "Seal victory"}
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
            <span className="k">Win payout</span>
            <span className="v">{payoutLabel}</span>
          </div>
        ) : (
          <div className="sm-claim-row">
            <span className="k">Refund</span>
            <span className="v">{stakeLabel}</span>
          </div>
        )}


        {claimSigil ? (
          <>
            <Divider />
            <div className="sm-claim-row">
              <span className="k">Lineage</span>
              <span className="v mono">{String(claimSigil.payload.lineageRootSigilId).slice(0, 10)}…</span>
            </div>
            <div className="sm-claim-trophy">
              <div className="sm-claim-trophy__label">Victory sigil</div>
              {claimSigil.svgUrl ? (
                <img src={claimSigil.svgUrl} alt="Victory sigil preview" className="sm-claim-trophy__img" />
              ) : null}
            </div>
            <Button
              variant="primary"
              onClick={() => void downloadBundle()}
              disabled={bundleBusy}
              loading={bundleBusy}
              leftIcon={<Icon name="download" size={14} tone="gold" />}
            >
              Download Victory Bundle (.zip)
            </Button>
          </>
        ) : null}
      </div>
    </Sheet>
  );
};
