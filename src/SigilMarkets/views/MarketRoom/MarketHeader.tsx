// SigilMarkets/views/MarketRoom/MarketHeader.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment, Market } from "../../types/marketTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip, type ChipTone } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";
import { MarketCountdown } from "./MarketCountdown";
import { useSigilMarketsUi } from "../../state/uiStore";
import { deriveMarketStatus } from "../../utils/marketTiming";

export type MarketHeaderProps = Readonly<{
  market: Market;
  now: KaiMoment;
}>;

type CountdownStatus = "open" | "closed" | "resolving" | "resolved";

const countdownStatus = (status: string): CountdownStatus => {
  if (status === "resolved" || status === "voided" || status === "canceled") return "resolved";
  if (status === "resolving") return "resolving";
  if (status === "closed") return "closed";
  return "open";
};

export const MarketHeader = (props: MarketHeaderProps) => {
  const { actions } = useSigilMarketsUi();
  const m = props.market;

  const status = deriveMarketStatus(m, props.now.pulse);

  const subtitle = useMemo(() => {
    const cat = m.def.category as unknown as string;
    const tags = (m.def.tags ?? []).slice(0, 2);
    return tags.length > 0 ? `${cat} • ${tags.join(" • ")}` : cat;
  }, [m.def.category, m.def.tags]);

  const closePulse = m.def.timing.closePulse;

  const statusLabel = useMemo(() => {
    if (status === "open") return "open";
    if (status === "closed") return "closed";
    if (status === "resolving") return "resolving";
    if (status === "resolved") return "resolved";
    if (status === "voided") return "void";
    if (status === "canceled") return "canceled";
    return status;
  }, [status]);

  const statusTone = useMemo<ChipTone>(() => {
    if (status === "resolved") return "success";
    if (status === "voided" || status === "canceled") return "danger";
    if (status === "resolving" || status === "closed") return "gold";
    return "default";
  }, [status]);

  return (
    <Card variant="glass" className="sm-mkt-header sm-breathe-soft">
      <CardContent>
        <div className="sm-mkt-header-top">
          <div className="sm-mkt-header-left">
            <div className="sm-mkt-header-q">{m.def.question}</div>
            <div className="sm-mkt-header-sub">{subtitle}</div>
            {m.def.description ? <div className="sm-mkt-header-desc">{m.def.description}</div> : null}
          </div>

          <div className="sm-mkt-header-right">
            <MarketCountdown
              now={props.now}
              closePulse={closePulse}
              status={countdownStatus(status)}
            />
          </div>
        </div>

        <div className="sm-mkt-header-actions">
          <Chip
            size="sm"
            selected={false}
            onClick={() => actions.pushSheet({ id: "seal-prediction", marketId: m.def.id })}
            tone="gold"
            left={<Icon name="spark" size={14} tone="gold" />}
          >
            Seal prophecy
          </Chip>

          <Chip
            size="sm"
            selected={false}
            onClick={() => actions.navigate({ view: "resolution", marketId: m.def.id })}
            tone="default"
            left={<Icon name="check" size={14} tone="dim" />}
          >
            Resolution
          </Chip>

          <Chip size="sm" selected={false} tone={statusTone} variant="outline">
            status • {statusLabel}
          </Chip>
        </div>
      </CardContent>
    </Card>
  );
};
