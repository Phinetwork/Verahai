// SigilMarkets/views/Positions/PositionCard.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { PositionRecord } from "../../types/sigilPositionTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useMarketById } from "../../state/marketStore";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";
import { PhiIcon } from "../../ui/atoms/PhiIcon";
import { formatPhiMicro, formatSharesMicro } from "../../utils/format";

export type PositionCardProps = Readonly<{
  position: PositionRecord;
  now: KaiMoment;
}>;

type ChipTone = "default" | "gold" | "danger" | "violet" | "success";

const toneForStatus = (st: string): ChipTone => {
  if (st === "claimable") return "gold";
  if (st === "lost") return "danger";
  if (st === "refundable") return "violet";
  if (st === "claimed") return "success";
  return "default";
};

const statusLabel = (st: string): string => {
  if (st === "claimable") return "won";
  if (st === "refundable") return "refundable";
  if (st === "lost") return "lost";
  if (st === "claimed") return "Won sealed";
  if (st === "refunded") return "refunded";
  return "open";
};

export const PositionCard = (props: PositionCardProps) => {
  const { actions } = useSigilMarketsUi();
  const p = props.position;

  const market = useMarketById(p.marketId);
  const question = market?.def.question ?? "Prophecy";

  const stakeLabel = useMemo(
    () => formatPhiMicro(p.entry.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }),
    [p.entry.stakeMicro],
  );

  const sharesLabel = useMemo(
    () => formatSharesMicro(p.entry.sharesMicro, { maxDecimals: 2 }),
    [p.entry.sharesMicro],
  );

  const pillTone = toneForStatus(p.status);

  const cls = useMemo(() => {
    if (p.status === "claimable") return "sm-pos-card sm-win-pop";
    if (p.status === "lost") return "sm-pos-card sm-loss-fade";
    return "sm-pos-card";
  }, [p.status]);

  const onOpen = (): void => {
    actions.openPosition(p.id);
  };

  return (
    <button type="button" className="sm-pos-card-btn" onClick={onOpen} aria-label="Open position">
      <Card variant="glass2" className={cls}>
        <CardContent compact>
          <div className="sm-pos-card-top">
            <div className="sm-pos-card-q">{question}</div>

            <Chip as="span" size="sm" selected={false} tone={pillTone} variant="outline">
              {statusLabel(p.status)}
            </Chip>
          </div>

          <div className="sm-pos-card-mid">
            <span className={`sm-pos-side ${p.entry.side === "YES" ? "is-yes" : "is-no"}`}>{p.entry.side}</span>

            <span className="sm-pos-mono">
              <PhiIcon size={12} /> {stakeLabel}
            </span>

            <span className="sm-pos-mono">
              <Icon name="positions" size={12} tone="dim" /> {sharesLabel}
            </span>
          </div>

          <div className="sm-small">
            opened p {p.entry.openedAt.pulse}
            {p.resolution ? ` • outcome ${p.resolution.outcome} @ p${p.resolution.resolvedPulse}` : ""}
          </div>
        </CardContent>
      </Card>
    </button>
  );
};
