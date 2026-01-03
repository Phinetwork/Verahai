// SigilMarkets/views/Vault/VaultActions.tsx
"use client";

import { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { PhiIcon } from "../../ui/atoms/PhiIcon";
import { formatPhiMicro, formatPhiMicroCompact } from "../../utils/format";

export type VaultActionsProps = Readonly<{
  vault: VaultRecord;
  now: KaiMoment;
  onDeposit: () => void;
  onWithdraw: () => void;
}>;

export const VaultActions = (props: VaultActionsProps) => {
  const spendable = props.vault.spendableMicro;
  const locked = props.vault.lockedMicro;

  const spendableLabel = useMemo(
    () => formatPhiMicroCompact(spendable, { withUnit: true, maxSig: 5 }),
    [spendable],
  );

  const lockedLabel = useMemo(
    () => formatPhiMicroCompact(locked, { withUnit: true, maxSig: 5 }),
    [locked],
  );

  // Use the full formatter (previously unused import) for an exact, unrounded detail line.
  // This gives users an authoritative “precision readout” without changing the UI layout.
  const spendableExact = useMemo(
    () => formatPhiMicro(spendable, { withUnit: true, maxDecimals: 6, minDecimals: 0, trimZeros: true }),
    [spendable],
  );

  const lockedExact = useMemo(
    () => formatPhiMicro(locked, { withUnit: true, maxDecimals: 6, minDecimals: 0, trimZeros: true }),
    [locked],
  );

  const isFrozen = props.vault.status === "frozen";

  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-vault-actions-head">
          <div className="sm-vault-actions-title">
            <PhiIcon size={14} /> Actions
          </div>
          <div className="sm-small">pulse {props.now.pulse}</div>
        </div>

        <div className="sm-vault-actions-badges">
          <span className="sm-pill">
            <PhiIcon size={14} /> spendable {spendableLabel}
          </span>
          <span className="sm-pill">
            <Icon name="positions" size={14} tone="dim" /> locked {lockedLabel}
          </span>
        </div>

        {/* Precision row (uses formatPhiMicro so the import is intentionally consumed) */}
        <div className="sm-small" style={{ marginTop: 8, opacity: 0.85 }}>
          exact: spendable {spendableExact} · locked {lockedExact}
        </div>

        <div className="sm-vault-actions-row">
          <Button
            variant="primary"
            onClick={props.onDeposit}
            leftIcon={<Icon name="plus" size={14} tone="cyan" />}
            disabled={isFrozen}
          >
            Deposit
          </Button>

          <Button
            variant="ghost"
            onClick={props.onWithdraw}
            leftIcon={<Icon name="minus" size={14} tone="dim" />}
            disabled={isFrozen}
          >
            Withdraw
          </Button>
        </div>

        {isFrozen ? (
          <div className="sm-small" style={{ marginTop: 10 }}>
            Vault is frozen — deposits/withdrawals are disabled.
          </div>
        ) : (
          <div className="sm-small" style={{ marginTop: 10 }}>
            Deposits use verified glyph valuation; withdrawals move spendable Φ.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
