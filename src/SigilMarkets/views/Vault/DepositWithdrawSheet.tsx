/* src/SigilMarkets/views/Vault/DepositWithdrawSheet.tsx */

"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { KaiMoment, PhiMicro } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { PhiIcon } from "../../ui/atoms/PhiIcon";
import { parsePhiToMicro, formatPhiMicro } from "../../utils/format";
import { useVaultActions } from "../../hooks/useVault";
import { useGlyphBalance } from "../../hooks/useGlyphBalance";
import { recordSigilTransferMovement } from "../../../utils/sigilTransferRegistry";
import KaiSigil, { type KaiSigilHandle } from "../../../components/KaiSigil";
import { download } from "../../../components/VerifierStamper/files";
import { momentFromPulse } from "../../../utils/kai_pulse";

type VaultTransferSigilPayloadV1 = Readonly<{
  v: "SM-VAULT-TRANSFER-1";
  kind: "vault-deposit" | "vault-withdraw";
  vaultId: string;
  userPhiKey: string;
  kaiSignature: string;
  identitySvgHash: string;
  amountPhi: string;
  amountMicro: string;
  spendableMicro: string;
  lockedMicro: string;
  transferPulse: number;
  canonicalHash?: string;
}>;

type TransferSigilReady = Readonly<{
  hash: string;
  url: string;
  metadataJson: string;
}>;

const encodeCdataJson = (payload: unknown): string =>
  JSON.stringify(payload, null, 2).replace(/]]>/g, "]]]]><![CDATA[>");

const writeVaultMetadataIntoSvg = async (svgBlob: Blob, payload: VaultTransferSigilPayloadV1): Promise<Blob> => {
  const raw = await svgBlob.text();
  const json = encodeCdataJson(payload);
  const tag = `<metadata id="sm-vault-transfer" data-type="application/json"><![CDATA[${json}]]></metadata>`;
  const patched = raw.replace(/<\/svg>\s*$/i, `${tag}</svg>`);
  return new Blob([patched], { type: "image/svg+xml" });
};

export type DepositWithdrawSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;
  mode: "deposit" | "withdraw";
  vault: VaultRecord;
  now: KaiMoment;
}>;

export const DepositWithdrawSheet = (props: DepositWithdrawSheetProps) => {
  const { deposit, withdraw } = useVaultActions();

  const [amt, setAmt] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [proofReady, setProofReady] = useState<TransferSigilReady | null>(null);
  const [proofBusy, setProofBusy] = useState(false);

  const sigilRef = useRef<KaiSigilHandle | null>(null);

  const title = props.mode === "deposit" ? "Deposit Φ" : "Withdraw Φ";
  const glyphBalance = useGlyphBalance(props.vault, props.now);

  const spendableLabel = useMemo(
    () => formatPhiMicro(props.vault.spendableMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }),
    [props.vault.spendableMicro],
  );

  const glyphAvailableMicro = glyphBalance.availableMicro ?? undefined;
  const glyphAvailableLabel = glyphBalance.availableLabel;
  const glyphAvailableUsdLabel = glyphBalance.availableUsdLabel;

  const glyphHash = useMemo(() => {
    const identity = props.vault.owner.identitySigil;
    if (!identity) return "";
    return String(identity.canonicalHash ?? identity.svgHash).toLowerCase();
  }, [props.vault.owner.identitySigil]);

  const transferMoment = useMemo(() => momentFromPulse(props.now.pulse), [props.now.pulse]);

  const buildWithdrawProof = useCallback(
    async (amountMicro: PhiMicro, amountPhiText: string): Promise<void> => {
      const identity = props.vault.owner.identitySigil;
      if (!identity) throw new Error("Missing identity glyph. Re-inhale your identity glyph to sync.");
      if (!sigilRef.current) throw new Error("Withdrawal proof renderer not ready yet. Please try again.");
      if (!proofReady) throw new Error("Withdrawal proof not ready yet. Please wait a moment and try again.");

      const svgBlob = await sigilRef.current.exportBlob("image/svg+xml");

      // bigint-safe clamp (NO Math.max on bigint)
      const nextSpendable: PhiMicro =
        props.vault.spendableMicro > amountMicro ? (props.vault.spendableMicro - amountMicro) : (0n as PhiMicro);

      const payload: VaultTransferSigilPayloadV1 = {
        v: "SM-VAULT-TRANSFER-1",
        kind: "vault-withdraw",
        vaultId: String(props.vault.vaultId),
        userPhiKey: String(props.vault.owner.userPhiKey),
        kaiSignature: String(props.vault.owner.kaiSignature),
        identitySvgHash: String(identity.svgHash),
        amountPhi: amountPhiText,
        amountMicro: amountMicro.toString(),
        spendableMicro: nextSpendable.toString(),
        lockedMicro: props.vault.lockedMicro.toString(),
        transferPulse: props.now.pulse,
        canonicalHash: proofReady.hash,
      };

      const wrappedSvg = await writeVaultMetadataIntoSvg(svgBlob, payload);
      download(wrappedSvg, `kaisigil_withdraw_${props.now.pulse}.svg`);
    },
    [proofReady, props.now.pulse, props.vault],
  );

  const apply = async (): Promise<void> => {
    const r = parsePhiToMicro(amt);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setErr(null);

    if (props.mode === "deposit") {
      const amountMicro = r.micro as PhiMicro;

      if (glyphAvailableMicro === undefined) {
        setErr("Glyph balance unavailable. Re-inhale your identity glyph to sync.");
        return;
      }
      if (glyphAvailableMicro < amountMicro) {
        setErr("Amount exceeds available glyph balance.");
        return;
      }
      if (!props.vault.owner.identitySigil) {
        setErr("Missing identity glyph. Re-inhale your identity glyph to sync.");
        return;
      }

      deposit(props.vault.vaultId, amountMicro, props.now.pulse);

      if (glyphHash) {
        const amountUsd =
          Number.isFinite(glyphBalance.usdPerPhi) && glyphBalance.usdPerPhi > 0
            ? (Number(amountMicro) / 1_000_000) * glyphBalance.usdPerPhi
            : undefined;

        recordSigilTransferMovement({
          hash: glyphHash,
          direction: "send",
          amountPhi: amt,
          amountUsd,
          sentPulse: props.now.pulse,
        });
      }
    } else {
      if (!props.vault.owner.identitySigil) {
        setErr("Missing identity glyph. Re-inhale your identity glyph to sync.");
        return;
      }
      if (!proofReady) {
        setErr("Withdrawal proof not ready yet. Please wait a moment and try again.");
        return;
      }

      withdraw(props.vault.vaultId, r.micro as PhiMicro, props.now.pulse);

      let proofErrored = false;
      try {
        setProofBusy(true);
        await buildWithdrawProof(r.micro as PhiMicro, amt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to mint withdrawal proof";
        setErr(msg);
        proofErrored = true;
      } finally {
        setProofBusy(false);
      }
      if (proofErrored) return;
    }

    setAmt("");
    props.onClose();
  };

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={title}
      subtitle={
        props.mode === "deposit"
          ? `Glyph available: ${glyphAvailableLabel}${
              glyphAvailableUsdLabel !== "—" ? ` • ≈ ${glyphAvailableUsdLabel}` : ""
            }`
          : `Spendable: ${spendableLabel}`
      }
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            disabled={amt.trim().length === 0 || (props.mode === "deposit" && glyphAvailableMicro === undefined) || proofBusy}
            leftIcon={<PhiIcon size={14} />}
          >
            Apply
          </Button>
        </div>
      }
    >
      <div className="sm-dw">
        {props.mode === "withdraw" ? (
          <div aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
            <KaiSigil
              ref={sigilRef}
              pulse={transferMoment.pulse}
              beat={transferMoment.beat}
              stepIndex={transferMoment.stepIndex}
              chakraDay={transferMoment.chakraDay}
              userPhiKey={String(props.vault.owner.userPhiKey)}
              kaiSignature={String(props.vault.owner.kaiSignature)}
              origin={typeof window !== "undefined" ? window.location.origin : undefined}
              animate={false}
              quality="high"
              showZKBadge={false}
              onReady={({ hash, url, metadataJson }) => {
                setProofReady({ hash, url, metadataJson });
              }}
              onError={() => {
                setProofReady(null);
              }}
            />
          </div>
        ) : null}

        <input
          className="sm-input"
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          placeholder="e.g. 5.0"
          inputMode="decimal"
        />

        {props.mode === "deposit" ? (
          <div className="sm-small" style={{ marginTop: 8 }}>
            Available on your glyph: <strong>{glyphAvailableLabel}</strong>
            {glyphAvailableUsdLabel !== "—" ? (
              <>
                {" "}
                <span style={{ opacity: 0.7 }}>≈ {glyphAvailableUsdLabel}</span>
              </>
            ) : null}
          </div>
        ) : null}

        {err ? <div className="sm-small" style={{ color: "rgba(255,104,104,0.90)", marginTop: 8 }}>{err}</div> : null}

        <Divider />
        <div className="sm-small">Deposits use live glyph verification; withdrawals move spendable Φ.</div>
      </div>
    </Sheet>
  );
};
