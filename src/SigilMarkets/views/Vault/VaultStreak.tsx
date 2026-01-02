// SigilMarkets/views/Vault/VaultStreak.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Icon, type IconProps } from "../../ui/atoms/Icon";

export type VaultStreakProps = Readonly<{
  vault: VaultRecord;
  now: KaiMoment;
}>;

export const VaultStreak = (props: VaultStreakProps) => {
  const s = props.vault.stats;
  const win = s?.winStreak ?? 0;
  const loss = s?.lossStreak ?? 0;

  const label = useMemo(() => {
    if (win > 0) return `${win} win streak`;
    if (loss > 0) return `${loss} loss streak`;
    return "fresh";
  }, [win, loss]);

  const iconTone: NonNullable<IconProps["tone"]> = win > 0 ? "success" : loss > 0 ? "danger" : "dim";

  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-vault-streak">
          <div className="sm-vault-streak-title">
            <Icon name="spark" size={14} tone={iconTone} /> Streak
          </div>
          <div className="sm-vault-streak-v">{label}</div>
          <div className="sm-small">pulse {props.now.pulse}</div>
        </div>
      </CardContent>
    </Card>
  );
};
