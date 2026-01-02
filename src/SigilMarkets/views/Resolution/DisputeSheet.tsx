// SigilMarkets/views/Resolution/DisputeSheet.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment, Market } from "../../types/marketTypes";
import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";

export type DisputeSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;
  market: Market;
  now: KaiMoment;
}>;

export const DisputeSheet = (props: DisputeSheetProps) => {
  const oracle = props.market.def.rules.oracle;
  const dw = oracle.disputeWindowPulses ?? 0;

  const subtitle = useMemo(() => {
    if (dw <= 0) return "This market is final on post (no dispute window).";
    return `Dispute window: ${dw} pulses after proposal.`;
  }, [dw]);

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="Dispute"
      subtitle={subtitle}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={props.onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => props.onClose()}
            leftIcon={<Icon name="warning" size={14} tone="gold" />}
            disabled={dw <= 0}
          >
            Open dispute
          </Button>
        </div>
      }
    >
      <div className="sm-small">
        MVP note: dispute workflow will be wired to your oracle policy:
        <ul style={{ marginTop: 8, paddingLeft: 18 }}>
          <li>committee quorum signatures</li>
          <li>crowd vote proofs</li>
          <li>evidence bundle sealing</li>
        </ul>
        <Divider />
        <div>pulse {props.now.pulse}</div>
      </div>
    </Sheet>
  );
};
