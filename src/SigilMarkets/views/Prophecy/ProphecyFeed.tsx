// SigilMarkets/views/Prophecy/ProphecyCard.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { ProphecyRecord } from "../../state/feedStore";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";
import { shortKey } from "../../utils/format";

export type ProphecyCardProps = Readonly<{
  prophecy: ProphecyRecord;
  now: KaiMoment;
  marketQuestion: string;
  onOpenMarket: () => void;
  onSealMore: () => void;
  onRemove: () => void;
}>;

const toneForStatus = (s: string): "default" | "gold" | "danger" | "success" | "violet" => {
  if (s === "sealed") return "gold";
  if (s === "fulfilled") return "success";
  if (s === "missed") return "danger";
  if (s === "void") return "violet";
  return "default";
};

export const ProphecyCard = (props: ProphecyCardProps) => {
  const p = props.prophecy;
  const status = p.resolution?.status ?? "sealed";

  const author = useMemo(() => shortKey(p.author.userPhiKey as unknown as string), [p.author.userPhiKey]);

  const outcomeText = useMemo(() => {
    if (!p.resolution) return "pending";
    return `${p.resolution.outcome} • p${p.resolution.resolvedPulse}`;
  }, [p.resolution]);

  return (
    <div className="sm-proph-item">
      <button type="button" className="sm-proph-btn" onClick={props.onOpenMarket} aria-label="Open market">
        <Card variant="glass2" className={`sm-proph-card ${status === "fulfilled" ? "sm-win-pop" : status === "missed" ? "sm-loss-fade" : ""}`}>
          <CardContent compact>
            <div className="sm-proph-top">
              <div className="sm-proph-q">{props.marketQuestion}</div>
              <Chip size="sm" selected={false} variant="outline" tone={toneForStatus(status)}>
                {status}
              </Chip>
            </div>

            <div className="sm-proph-mid">
              <span className={`sm-proph-side ${p.side === "YES" ? "is-yes" : "is-no"}`}>{p.side}</span>
              <span className="sm-small">sealed p {p.createdAt.pulse}</span>
              <span className="sm-small">by {author}</span>
            </div>

            <div className="sm-proph-foot">
              <span className="sm-pill">
                <Icon name="check" size={14} tone="dim" /> {outcomeText}
              </span>

              {p.positionId ? (
                <span className="sm-pill">
                  <Icon name="positions" size={14} tone="dim" /> linked
                </span>
              ) : null}

              {p.visibility === "private" ? (
                <span className="sm-pill">
                  <Icon name="warning" size={14} tone="dim" /> private
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </button>

      <div className="sm-proph-actions">
        <Chip size="sm" selected={false} onClick={props.onSealMore} tone="gold" left={<Icon name="plus" size={14} tone="gold" />}>
          Seal
        </Chip>
        <Chip size="sm" selected={false} onClick={props.onRemove} variant="outline" tone="danger" left={<Icon name="x" size={14} tone="danger" />}>
          Remove
        </Chip>
      </div>
    </div>
  );
};
