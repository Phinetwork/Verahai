// SigilMarkets/views/Positions/PositionDetail.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { KaiMoment, MarketId } from "../../types/marketTypes";
import type { PositionId } from "../../types/sigilPositionTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { usePosition } from "../../hooks/usePositions";
import { useMarketById } from "../../state/marketStore";
import { useActiveVault } from "../../state/vaultStore";
import { TopBar } from "../../ui/chrome/TopBar";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
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

const statusLabel = (st: string): string => {
  if (st === "claimable") return "won";
  if (st === "claimed") return "Won sealed";
  if (st === "refundable") return "refundable";
  if (st === "refunded") return "refunded";
  if (st === "lost") return "lost";
  return "open";
};

export const PositionDetail = (props: PositionDetailProps) => {
  const { state: uiState, actions } = useSigilMarketsUi();

  useScrollRestoration(uiState.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const p = usePosition(props.positionId);
  const activeVault = useActiveVault();

  // Hooks must be called unconditionally. Use a safe sentinel id when position is missing.
  const lookupMarketId: MarketId = (p?.marketId ?? ("__none__" as unknown as MarketId)) as MarketId;
  const market = useMarketById(lookupMarketId);

  const [claimOpen, setClaimOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const view = useMemo(() => {
    if (!p) {
      return {
        missing: true as const,
        question: "Prophecy",
        subtitle: "Missing",
        stake: "",
        shares: "",
        lockIdShort: "",
        lockIdRaw: "",
      };
    }

    const q = market?.def.question ?? "Prophecy";
    const stake = formatPhiMicro(p.entry.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true });
    const shares = formatSharesMicro(p.entry.sharesMicro, { maxDecimals: 2 });
    const lockIdRaw = p.lock.lockId as unknown as string;

    return {
      missing: false as const,
      question: q,
      subtitle: `${statusLabel(p.status)} • p${p.entry.openedAt.pulse}`,
      stake,
      shares,
      lockIdShort: shortHash(lockIdRaw, 10, 6),
      lockIdRaw,
    };
  }, [market, p]);

  const onBack = (): void => {
    actions.backToGrid();
  };

  // IMPORTANT: Narrow on `p` directly so TS knows position is non-null below.
  if (!p) {
    return (
      <div className="sm-page" data-sm="position-detail">
        <TopBar
          title="Position"
          subtitle={view.subtitle}
          now={props.now}
          scrollMode={props.scrollMode}
          scrollRef={props.scrollRef}
          back
          onBack={onBack}
        />
        <Card variant="glass">
          <CardContent>
            <div className="sm-title">Position not found.</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const position = p;
  const hasClaimProof =
    !!position.resolution && (position.status === "claimable" || position.status === "lost");
  const exportLabel = hasClaimProof
    ? position.status === "lost"
      ? "Download loss proof"
      : "Download victory proof"
    : "Export";
  const canAccessVault = !!activeVault && activeVault.vaultId === position.lock.vaultId;

  const openClaimSheet = (): void => {
    if (!canAccessVault) {
      actions.pushSheet({ id: "inhale-glyph", reason: "vault" });
      return;
    }
    setClaimOpen(true);
  };

  return (
    <div className="sm-page" data-sm="position-detail">
      <TopBar
        title="Position"
        subtitle={view.subtitle}
        now={props.now}
        scrollMode={props.scrollMode}
        scrollRef={props.scrollRef}
        back
        onBack={onBack}
      />

      <Card variant="glass" className="sm-pos-detail">
        <CardContent>
          <div className="sm-pos-detail-q">{view.question}</div>

          <div className="sm-pos-detail-row">
            <span className={`sm-pos-side ${position.entry.side === "YES" ? "is-yes" : "is-no"}`}>{position.entry.side}</span>
            <span className="sm-pill">{statusLabel(position.status)}</span>
          </div>

          <Divider />

          <div className="sm-pos-detail-grid">
            <div className="row">
              <span className="k">Stake</span>
              <span className="v">{view.stake}</span>
            </div>
            <div className="row">
              <span className="k">Shares</span>
              <span className="v">{view.shares}</span>
            </div>
            <div className="row">
              <span className="k">Lock</span>
              <span className="v mono">{view.lockIdShort}</span>
            </div>
          </div>

          <Divider />

          <div className="sm-pos-detail-actions">
            {position.status === "claimable" || position.status === "refundable" ? (
              <Button
                variant="primary"
                onClick={openClaimSheet}
                leftIcon={<Icon name="check" size={14} tone="gold" />}
              >
                {position.status === "claimable" ? "Claim victory" : "Refund"}
              </Button>
            ) : null}

            <Button variant="ghost" onClick={() => setExportOpen(true)} leftIcon={<Icon name="export" size={14} tone="dim" />}>
              {exportLabel}
            </Button>

            <Button variant="ghost" onClick={() => setTransferOpen(true)} leftIcon={<Icon name="share" size={14} tone="dim" />}>
              Transfer
            </Button>
          </div>

          <Divider />

          <PositionTimeline position={position} />
        </CardContent>
      </Card>

      <ClaimSheet open={claimOpen} onClose={() => setClaimOpen(false)} position={position} now={props.now} />
      <ExportPositionSheet open={exportOpen} onClose={() => setExportOpen(false)} position={position} />
      <TransferPositionSheet open={transferOpen} onClose={() => setTransferOpen(false)} position={position} />
    </div>
  );
};
