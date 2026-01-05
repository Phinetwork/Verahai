// SigilMarkets/views/Vault/VaultProphecySigils.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { ProphecySigilCard } from "../Prophecy/ProphecySigilCard";
import { useProphecySigils } from "../../hooks/useProphecySigils";

export type VaultProphecySigilsProps = Readonly<{
  vault: VaultRecord;
  now: KaiMoment;
}>;

export const VaultProphecySigils = (props: VaultProphecySigilsProps) => {
  const { prophecies, actions } = useProphecySigils();

  const owned = useMemo(() => {
    const key = props.vault.owner.userPhiKey as unknown as string;
    return prophecies.filter((p) => p.sigil?.payload.userPhiKey === key);
  }, [prophecies, props.vault.owner.userPhiKey]);

  if (owned.length === 0) {
    return (
      <Card variant="glass" className="sm-vault-proph-empty">
        <CardContent>
          <div className="sm-title">No prophecy sigils yet.</div>
          <div className="sm-subtitle" style={{ marginTop: 8 }}>
            Seal a prophecy to see it listed here with offline verification badges.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="sm-vault-proph-list">
      {owned.map((p) => (
        <ProphecySigilCard
          key={p.id as unknown as string}
          prophecy={p}
          now={props.now}
          onRemove={() => actions.remove(p.id)}
        />
      ))}
    </div>
  );
};
