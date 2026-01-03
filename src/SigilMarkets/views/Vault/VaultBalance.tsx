// SigilMarkets/views/Vault/VaultBalance.tsx
"use client";

import React, { useMemo } from "react";
import type { VaultRecord } from "../../types/vaultTypes";
import type { PhiMicro } from "../../types/marketTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { PhiIcon } from "../../ui/atoms/PhiIcon";
import { formatPhiMicro, formatPhiMicroCompact } from "../../utils/format";

export type VaultBalanceProps = Readonly<{
  vault: VaultRecord;
}>;

export const VaultBalance = (props: VaultBalanceProps) => {
  const spendable = props.vault.spendableMicro;
  const locked = props.vault.lockedMicro;

  const spendableLabel = useMemo(
    () => formatPhiMicro(spendable, { withUnit: true, maxDecimals: 6, trimZeros: true }),
    [spendable],
  );
  const lockedLabel = useMemo(
    () => formatPhiMicro(locked, { withUnit: true, maxDecimals: 6, trimZeros: true }),
    [locked],
  );

  const totalMicro = useMemo(
    () => (((spendable as unknown as bigint) + (locked as unknown as bigint)) as unknown) as PhiMicro,
    [spendable, locked],
  );
  const totalLabel = useMemo(() => formatPhiMicroCompact(totalMicro, { withUnit: true, maxSig: 5 }), [totalMicro]);

  return (
    <Card variant="glass2" className="sm-vault-bal">
      <CardContent>
        <div className="sm-vault-bal-head">
          <div className="sm-vault-bal-title">
            <PhiIcon size={14} /> Balance
          </div>
          <div className="sm-vault-bal-total">{totalLabel}</div>
        </div>

        <div className="sm-vault-bal-grid">
          <div className="sm-vault-bal-row">
            <span className="k">spendable</span>
            <span className="v">{spendableLabel}</span>
          </div>
          <div className="sm-vault-bal-row">
            <span className="k">locked</span>
            <span className="v">{lockedLabel}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
