// SigilMarkets/views/MarketRoom/MarketActivity.tsx
"use client";

import React, { useMemo } from "react";
import type { Market, MarketActivityEvent } from "../../types/marketTypes";
import { useMarketActivity } from "../../state/feedStore";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro, formatSharesMicro } from "../../utils/format";

export type MarketActivityProps = Readonly<{
  market: Market;
}>;

const labelFor = (e: MarketActivityEvent): string => {
  if (e.type === "market-created") return "Prophecy created";
  if (e.type === "market-closed") return "Prophecy closed";
  if (e.type === "resolution-proposed") return `Resolution proposed • ${e.outcome}`;
  if (e.type === "market-resolved") return `Resolved • ${e.outcome}`;
  return "Trade";
};

const iconFor = (e: MarketActivityEvent): string => {
  if (e.type === "trade") return "◎";
  if (e.type === "market-created") return "✶";
  if (e.type === "market-closed") return "⟡";
  if (e.type === "resolution-proposed") return "!";
  return "✓";
};

export const MarketActivity = (props: MarketActivityProps) => {
  const events = useMarketActivity(props.market.def.id);

  const items = useMemo(() => [...events].reverse().slice(0, 18), [events]);

  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-act-head">
          <div className="sm-act-title">
            <Icon name="spark" size={14} tone="dim" /> Activity
          </div>
          <div className="sm-small">{events.length} events</div>
        </div>

        <Divider />

        {items.length === 0 ? (
          <div className="sm-subtitle" style={{ marginTop: 10 }}>
            No activity yet.
          </div>
        ) : (
          <div className="sm-act-list">
            {items.map((e, idx) => (
              <div key={`${e.type}-${e.atPulse}-${idx}`} className="sm-act-item">
                <div className="sm-act-ico" aria-hidden="true">
                  {iconFor(e)}
                </div>
                <div className="sm-act-main">
                  <div className="sm-act-line">
                    <span className="sm-act-label">{labelFor(e)}</span>
                    <span className="sm-act-pulse">p {e.atPulse}</span>
                  </div>

                  {e.type === "trade" ? (
                    <div className="sm-act-sub">
                      <span className={`sm-act-side ${e.side === "YES" ? "is-yes" : "is-no"}`}>{e.side}</span>
                      <span className="sm-act-mono">
                        {formatPhiMicro(e.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true })}
                      </span>
                      <span className="sm-act-mono">{formatSharesMicro(e.sharesMicro, { maxDecimals: 2 })}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
