// SigilMarkets/views/Resolution/ResolutionCenter.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { KaiMoment, MarketId } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { useMarket } from "../../hooks/useMarket";

import { TopBar } from "../../ui/chrome/TopBar";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";

import { OutcomeReveal } from "./OutcomeReveal";
import { EvidenceViewer } from "./EvidenceViewer";
import { DisputeSheet } from "./DisputeSheet";
import { ResolutionSigilCard } from "./ResolutionSigilCard";
import { deriveMarketStatus } from "../../utils/marketTiming";

export type ResolutionCenterProps = Readonly<{
  marketId: MarketId;
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

const statusLabel = (s: string): string => {
  if (s === "open") return "open";
  if (s === "closed") return "closed";
  if (s === "resolving") return "resolving";
  if (s === "resolved") return "resolved";
  if (s === "voided") return "void";
  if (s === "canceled") return "canceled";
  return s;
};

export const ResolutionCenter = (props: ResolutionCenterProps) => {
  const { state: uiState, actions: ui } = useSigilMarketsUi();

  useScrollRestoration(uiState.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const m = useMarket(props.marketId, props.now.pulse);
  const [disputeOpen, setDisputeOpen] = useState(false);

  // ✅ Hooks must be unconditional: compute memoized subtitle using safe fallbacks.
  const subtitle = useMemo(() => {
    const market = m.market;
    if (!market) return "Missing market";
    const derived = deriveMarketStatus(market, props.now.pulse);
    return `${market.def.category} • ${statusLabel(derived)}`;
  }, [m.market, props.now.pulse]);

  if (!m.market) {
    return (
      <div className="sm-page" data-sm="resolution">
        <TopBar
          title="Resolution"
          subtitle={subtitle}
          now={props.now}
          scrollMode={props.scrollMode}
          scrollRef={props.scrollRef}
          back
        />
        <Card variant="glass">
          <CardContent>
            <div className="sm-title">Market not found.</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const market = m.market;
  const r = market.state.resolution;
  const derivedStatus = deriveMarketStatus(market, props.now.pulse);

  return (
    <div className="sm-page" data-sm="resolution">
      <TopBar
        title="Resolution"
        subtitle={subtitle}
        now={props.now}
        scrollMode={props.scrollMode}
        scrollRef={props.scrollRef}
        back
        onBack={() => ui.navigate({ view: "market", marketId: market.def.id })}
      />

      <div className="sm-res-stack">
        <ResolutionSigilCard market={market} />

        {r ? (
          <OutcomeReveal outcome={r.outcome} resolvedPulse={r.resolvedPulse} statusLabel={statusLabel(derivedStatus)} />
        ) : (
          <Card variant="glass">
            <CardContent>
              <div className="sm-title">Awaiting resolution.</div>
              <div className="sm-subtitle" style={{ marginTop: 8 }}>
                This market will be resolved by its oracle policy. When posted, you’ll be able to claim/refund positions.
              </div>
            </CardContent>
          </Card>
        )}

        <EvidenceViewer market={market} />

        <Divider />

        <div className="sm-res-actions">
          <Button
            variant="ghost"
            onClick={() => setDisputeOpen(true)}
            leftIcon={<Icon name="warning" size={14} tone="gold" />}
          >
            Dispute
          </Button>

          <Button
            variant="primary"
            onClick={() => ui.toast("info", "Export coming next", "We will wire ResolutionSigilMint + SigilExport.")}
            leftIcon={<Icon name="export" size={14} tone="dim" />}
            disabled={!r}
          >
            Export Resolution Sigil
          </Button>
        </div>
      </div>

      <DisputeSheet open={disputeOpen} onClose={() => setDisputeOpen(false)} market={market} now={props.now} />
    </div>
  );
};
