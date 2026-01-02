// SigilMarkets/views/Resolution/OutcomeReveal.tsx
"use client";

import React, { useMemo } from "react";
import type { MarketOutcome } from "../../types/marketTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Icon } from "../../ui/atoms/Icon";
import { Chip } from "../../ui/atoms/Chip";

export type OutcomeRevealProps = Readonly<{
  outcome: MarketOutcome;
  resolvedPulse: number;
  statusLabel: string;
}>;

const toneFor = (o: MarketOutcome): "success" | "danger" | "violet" => {
  if (o === "YES") return "success";
  if (o === "NO") return "danger";
  return "violet"; // VOID
};

export const OutcomeReveal = (props: OutcomeRevealProps) => {
  const tone = useMemo(() => toneFor(props.outcome), [props.outcome]);

  const headline = useMemo(() => {
    if (props.outcome === "YES") return "YES";
    if (props.outcome === "NO") return "NO";
    return "VOID";
  }, [props.outcome]);

  const sub = useMemo(() => `resolved p ${props.resolvedPulse} • ${props.statusLabel}`, [props.resolvedPulse, props.statusLabel]);

  return (
    <Card variant="glass" className={`sm-outcome sm-win-pop`}>
      <CardContent>
        <div className="sm-outcome-top">
          <div className="sm-outcome-title">
            <Icon name="check" size={14} tone="dim" /> Outcome
          </div>
          <Chip size="sm" selected={false} tone={tone} variant="outline">
            {headline}
          </Chip>
        </div>

        <div className={`sm-outcome-big ${headline === "YES" ? "is-yes" : headline === "NO" ? "is-no" : "is-void"}`}>
          {headline}
        </div>

        <div className="sm-outcome-sub">{sub}</div>
      </CardContent>
    </Card>
  );
};
