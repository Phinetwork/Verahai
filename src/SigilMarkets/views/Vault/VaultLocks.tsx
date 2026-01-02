// SigilMarkets/views/Vault/VaultLocks.tsx
"use client";

import React, { useMemo } from "react";
import type { VaultRecord, VaultLock } from "../../types/vaultTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro } from "../../utils/format";

export type VaultLocksProps = Readonly<{
  vault: VaultRecord;
}>;

const sortLocks = (locks: readonly VaultLock[]): readonly VaultLock[] => {
  const arr = [...locks];
  arr.sort((a, b) => b.updatedPulse - a.updatedPulse);
  return arr;
};

export const VaultLocks = (props: VaultLocksProps) => {
  const locks = useMemo(() => sortLocks(props.vault.locks), [props.vault.locks]);

  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-vault-locks-head">
          <div className="sm-vault-locks-title">
            <Icon name="positions" size={14} tone="dim" /> Locks
          </div>
          <div className="sm-small">{locks.filter((l) => l.status === "locked").length} active</div>
        </div>

        <Divider />

        {locks.length === 0 ? (
          <div className="sm-subtitle" style={{ marginTop: 10 }}>
            No locks yet.
          </div>
        ) : (
          <div className="sm-vault-locks-list">
            {locks.slice(0, 12).map((l) => (
              <div key={l.lockId as unknown as string} className={`sm-vault-lock ${l.status === "locked" ? "is-live" : ""}`}>
                <div className="sm-vault-lock-top">
                  <span className="sm-vault-lock-id mono">{(l.lockId as unknown as string).slice(0, 16)}…</span>
                  <span className={`sm-vault-lock-status ${l.status}`}>{l.status}</span>
                </div>
                <div className="sm-vault-lock-mid">
                  <span className="sm-vault-lock-amt">
                    {formatPhiMicro(l.amountMicro, { withUnit: true, maxDecimals: 6, trimZeros: true })}
                  </span>
                  <span className="sm-vault-lock-pulse">p {l.updatedPulse}</span>
                </div>
                <div className="sm-small">{l.note ?? l.reason}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
