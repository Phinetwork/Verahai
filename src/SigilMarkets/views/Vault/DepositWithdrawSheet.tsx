// SigilMarkets/views/Vault/DepositWithdrawSheet.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { KaiMoment, PhiMicro } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { parsePhiToMicro, formatPhiMicro } from "../../utils/format";
import { useVaultActions } from "../../hooks/useVault";
import { recordSigilTransferMovement } from "../../../utils/sigilTransferRegistry";

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

  const title = props.mode === "deposit" ? "Deposit Φ" : "Withdraw Φ";

  const spendableLabel = useMemo(
    () => formatPhiMicro(props.vault.spendableMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }),
    [props.vault.spendableMicro],
  );

  const glyphAvailableMicro = props.vault.owner.identitySigil?.availablePhiMicro;
  const glyphAvailableLabel = useMemo(
    () =>
      glyphAvailableMicro !== undefined
        ? formatPhiMicro(glyphAvailableMicro, { withUnit: true, maxDecimals: 6, trimZeros: true })
        : "—",
    [glyphAvailableMicro],
  );

  const glyphHash = (props.vault.owner.identitySigil?.canonicalHash ??
    (props.vault.owner.identitySigil?.svgHash as unknown as string) ??
    "")
    .toString()
    .toLowerCase();

  const apply = (): void => {
    const r = parsePhiToMicro(amt);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setErr(null);

    if (props.mode === "deposit") {
      if (glyphAvailableMicro === undefined) {
        setErr("Glyph balance unavailable. Re-inhale your identity glyph to sync.");
        return;
      }
      if (glyphAvailableMicro < (r.micro as PhiMicro)) {
        setErr("Amount exceeds available glyph balance.");
        return;
      }
      deposit(props.vault.vaultId, r.micro as PhiMicro, props.now.pulse);
      if (glyphHash) {
        recordSigilTransferMovement({
          hash: glyphHash,
          direction: "send",
          amountPhi: amt,
          sentPulse: props.now.pulse,
        });
      }
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
        props.mode === "deposit" ? `Glyph available: ${glyphAvailableLabel}` : `Spendable: ${spendableLabel}`
      }
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={apply}
            disabled={amt.trim().length === 0 || (props.mode === "deposit" && glyphAvailableMicro === undefined)}
            leftIcon={<Icon name="vault" size={14} tone="gold" />}
          >
            Apply
          </Button>
        </div>
      }
    >
      <div className="sm-dw">
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
          </div>
        ) : null}
        {err ? <div className="sm-small" style={{ color: "rgba(255,104,104,0.90)", marginTop: 8 }}>{err}</div> : null}
        <Divider />
        <div className="sm-small">Deposits use live glyph verification; withdrawals move spendable Φ.</div>
      </div>
    </Sheet>
  );
};
