// SigilMarkets/views/Positions/PositionDetail.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { KaiMoment, MarketId } from "../../types/marketTypes";
import type { PositionId } from "../../types/sigilPositionTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useMarketById } from "../../state/marketStore";
import { usePosition } from "../../hooks/usePositions";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { TopBar } from "../../ui/chrome/TopBar";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { Chip } from "../../ui/atoms/Chip";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro, formatSharesMicro, shortHash } from "../../utils/format";
import { ClaimSheet } from "./ClaimSheet";
import { ExportPositionSheet } from "./ExportPositionSheet";
import { TransferPositionSheet } from "./TransferPositionSheet";
import { PositionTimeline } from "./PositionTimeline";

export type PositionDetailProps = Readonly<{
  positionId: PositionId;
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
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
  if (st === "claimable") return "claimable";
  if (st === "refundable") return "refundable";
  if (st === "lost") return "lost";
  if (st === "claimed") return "claimed";
  if (st === "refunded") return "refunded";
  return "open";
};

export const PositionDetail = (props: PositionDetailProps) => {
  const { state: uiState, actions: ui } = useSigilMarketsUi();

  useScrollRestoration(uiState.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const position = usePosition(props.positionId);
  const market = useMarketById(position?.marketId ?? ("" as MarketId));
  const question = market?.def.question ?? "Market";

  const [claimOpen, setClaimOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const onBack = (): void => ui.navigate({ view: "positions" });

  if (!position) {
    return (
      <div className="sm-page" data-sm="position">
        <TopBar
          title="Position"
          subtitle="Position not found"
          now={props.now}
          scrollMode={props.scrollMode}
          scrollRef={props.scrollRef}
          back
          onBack={onBack}
        />

        <Card variant="glass">
          <CardContent>
            <div className="sm-title">Position unavailable</div>
            <div className="sm-subtitle" style={{ marginTop: 8 }}>
              This position is no longer available locally. Try returning to your positions list.
            </div>
            <div style={{ marginTop: 12 }}>
              <Button variant="primary" onClick={onBack} leftIcon={<Icon name="back" size={14} tone="dim" />}>
                Back to positions
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stakeLabel = useMemo(
    () => formatPhiMicro(position.entry.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }),
    [position.entry.stakeMicro],
  );

  const sharesLabel = useMemo(
    () => formatSharesMicro(position.entry.sharesMicro, { maxDecimals: 2 }),
    [position.entry.sharesMicro],
  );

  const isClaimable = position.status === "claimable" || position.status === "refundable";
  const claimLabel = position.status === "refundable" ? "Refund" : "Claim";

  return (
    <div className="sm-page" data-sm="position">
      <TopBar
        title="Position"
        subtitle={`${statusLabel(position.status)} • p${position.entry.openedAt.pulse}`}
        now={props.now}
        scrollMode={props.scrollMode}
        scrollRef={props.scrollRef}
        back
        onBack={onBack}
      />

      <div className="sm-pos-detail">
        <Card variant="glass">
          <CardContent>
            <div className="sm-pos-detail-q">{question}</div>

            <div className="sm-pos-detail-row">
              <Chip size="sm" selected={false} variant="outline" tone={toneForStatus(position.status)}>
                {statusLabel(position.status)}
              </Chip>
              <Chip size="sm" selected={false} variant="outline" tone={position.entry.side === "YES" ? "cyan" : "violet"}>
                {position.entry.side}
              </Chip>
            </div>

            <div className="sm-pos-detail-grid">
              <div className="row">
                <span className="k">Position</span>
                <span className="v mono">{shortHash(position.id as unknown as string, 14, 10)}</span>
              </div>
              <div className="row">
                <span className="k">Market</span>
                <span className="v mono">{shortHash(position.marketId as unknown as string, 14, 10)}</span>
              </div>
              <div className="row">
                <span className="k">Stake</span>
                <span className="v">{stakeLabel}</span>
              </div>
              <div className="row">
                <span className="k">Shares</span>
                <span className="v">{sharesLabel}</span>
              </div>
              <div className="row">
                <span className="k">Opened</span>
                <span className="v">p {position.entry.openedAt.pulse}</span>
              </div>
              <div className="row">
                <span className="k">Outcome</span>
                <span className="v">{position.resolution?.outcome ?? "—"}</span>
              </div>
            </div>

            <Divider />

            <div className="sm-pos-detail-actions">
              <Button
                variant="primary"
                onClick={() => setClaimOpen(true)}
                disabled={!isClaimable}
                leftIcon={<Icon name="check" size={14} tone={isClaimable ? "gold" : "dim"} />}
              >
                {claimLabel}
              </Button>

              <Button variant="ghost" onClick={() => setExportOpen(true)} leftIcon={<Icon name="share" size={14} tone="dim" />}>
                Export
              </Button>

              <Button variant="ghost" onClick={() => setTransferOpen(true)} leftIcon={<Icon name="share" size={14} tone="dim" />}>
                Transfer
              </Button>

              {market ? (
                <Button variant="ghost" onClick={() => ui.navigate({ view: "market", marketId: market.def.id })}>
                  Open market
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <PositionTimeline position={position} />
      </div>

      <ClaimSheet open={claimOpen} onClose={() => setClaimOpen(false)} position={position} now={props.now} />
      <ExportPositionSheet open={exportOpen} onClose={() => setExportOpen(false)} position={position} />
      <TransferPositionSheet open={transferOpen} onClose={() => setTransferOpen(false)} position={position} />
    </div>
  );
};
