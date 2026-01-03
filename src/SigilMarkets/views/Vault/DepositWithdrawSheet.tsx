// SigilMarkets/views/Vault/DepositWithdrawSheet.tsx
"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { KaiMoment, PhiMicro } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { parsePhiToMicro, formatPhiMicro } from "../../utils/format";
import { useVaultActions } from "../../hooks/useVault";
import { useGlyphBalance } from "../../hooks/useGlyphBalance";
import { recordSigilTransferMovement } from "../../../utils/sigilTransferRegistry";
import KaiSigil, { type KaiSigilHandle } from "../../../components/KaiSigil";
import { download } from "../../../components/VerifierStamper/files";
import { momentFromPulse, STEPS_BEAT } from "../../../utils/kai_pulse";
import { makeSigilUrlLoose, type SigilSharePayloadLoose } from "../../../utils/sigilUrl";
import { registerSigilUrl } from "../../../utils/sigilRegistry";

type VaultDepositSigilPayloadV1 = Readonly<{
  v: "SM-VAULT-DEPOSIT-1";
  kind: "vault-deposit";
  vaultId: string;
  userPhiKey: string;
  kaiSignature: string;
  identitySvgHash: string;
  amountPhi: string;
  amountMicro: string;
  spendableMicro: string;
  lockedMicro: string;
  depositPulse: number;
  canonicalHash?: string;
}>;

type DepositSigilReady = Readonly<{
  hash: string;
  url: string;
  metadataJson: string;
}>;

const encodeCdataJson = (payload: unknown): string =>
  JSON.stringify(payload, null, 2).replace(/]]>/g, "]]]]><![CDATA[>");

const writeDepositMetadataIntoSvg = async (
  svgBlob: Blob,
  payload: VaultDepositSigilPayloadV1,
): Promise<Blob> => {
  const raw = await svgBlob.text();
  const json = encodeCdataJson(payload);
  const tag = `<metadata id="sm-vault-deposit" data-type="application/json"><![CDATA[${json}]]></metadata>`;
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
  const [proofReady, setProofReady] = useState<DepositSigilReady | null>(null);
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

  const glyphHash = (props.vault.owner.identitySigil?.canonicalHash ??
    (props.vault.owner.identitySigil?.svgHash as unknown as string) ??
    "")
    .toString()
    .toLowerCase();

  const depositMoment = useMemo(() => momentFromPulse(props.now.pulse), [props.now.pulse]);

  const buildDepositProof = useCallback(
    async (amountMicro: PhiMicro, amountPhiText: string): Promise<void> => {
      const identity = props.vault.owner.identitySigil;
      if (!identity) return;
      if (!sigilRef.current || !proofReady) return;

      const svgBlob = await sigilRef.current.exportBlob("image/svg+xml");

      const payload: VaultDepositSigilPayloadV1 = {
        v: "SM-VAULT-DEPOSIT-1",
        kind: "vault-deposit",
        vaultId: String(props.vault.vaultId),
        userPhiKey: String(props.vault.owner.userPhiKey),
        kaiSignature: String(props.vault.owner.kaiSignature),
        identitySvgHash: String(identity.svgHash),
        amountPhi: amountPhiText,
        amountMicro: amountMicro.toString(),
        spendableMicro: (props.vault.spendableMicro + amountMicro).toString(),
        lockedMicro: props.vault.lockedMicro.toString(),
        depositPulse: props.now.pulse,
        canonicalHash: proofReady.hash,
      };

      const wrappedSvg = await writeDepositMetadataIntoSvg(svgBlob, payload);

      const payloadLoose: SigilSharePayloadLoose & Record<string, unknown> = {
        pulse: depositMoment.pulse,
        beat: depositMoment.beat,
        stepIndex: depositMoment.stepIndex,
        chakraDay: depositMoment.chakraDay,
        stepsPerBeat: STEPS_BEAT,
        kaiSignature: String(props.vault.owner.kaiSignature),
        userPhiKey: String(props.vault.owner.userPhiKey),
        canonicalHash: proofReady.hash,
        transferDirection: "send",
        transferAmountPhi: amountPhiText,
        transferPulse: props.now.pulse,
        vaultId: String(props.vault.vaultId),
        identitySvgHash: String(identity.svgHash),
        depositProof: payload,
      };

      const sigilUrl = makeSigilUrlLoose(proofReady.hash, payloadLoose, {
        origin: typeof window !== "undefined" ? window.location.origin : "",
        parentUrl: identity.url,
      });
      if (sigilUrl) {
        registerSigilUrl(sigilUrl);
      }

      download(wrappedSvg, `kaisigil_deposit_${props.now.pulse}.svg`);
    },
    [depositMoment, proofReady, props.now.pulse, props.vault],
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
      if (!proofReady) {
        setErr("Deposit proof not ready yet. Please wait a moment and try again.");
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
      let proofErrored = false;
      try {
        setProofBusy(true);
        await buildDepositProof(amountMicro, amt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to mint deposit proof";
        setErr(msg);
        proofErrored = true;
      } finally {
        setProofBusy(false);
      }
      if (proofErrored) return;
    } else {
      withdraw(props.vault.vaultId, r.micro as PhiMicro, props.now.pulse);
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
          ? `Glyph available: ${glyphAvailableLabel}${glyphAvailableUsdLabel !== "—" ? ` • ≈ ${glyphAvailableUsdLabel}` : ""}`
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
            disabled={
              amt.trim().length === 0 ||
              (props.mode === "deposit" && (glyphAvailableMicro === undefined || !proofReady)) ||
              proofBusy
            }
            leftIcon={<Icon name="vault" size={14} tone="gold" />}
          >
            Apply
          </Button>
        </div>
      }
    >
      <div className="sm-dw">
        {props.mode === "deposit" ? (
          <div aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
            <KaiSigil
              ref={sigilRef}
              pulse={depositMoment.pulse}
              beat={depositMoment.beat}
              stepIndex={depositMoment.stepIndex}
              chakraDay={depositMoment.chakraDay}
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
