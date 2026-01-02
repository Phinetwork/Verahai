// SigilMarkets/SigilMarketsRoutes.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment, MarketId } from "./types/marketTypes";
import { useSigilMarketsUi } from "./state/uiStore";

import { MarketGrid } from "./views/MarketGrid/MarketGrid";
import { MarketRoom } from "./views/MarketRoom/MarketRoom";
import { VaultPanel } from "./views/Vault/VaultPanel";
import { PositionsHome } from "./views/Positions/PositionsHome";
import { PositionDetail } from "./views/Positions/PositionDetail";
import { ProphecyFeed } from "./views/Prophecy/ProphecyFeed";
import { ResolutionCenter } from "./views/Resolution/ResolutionCenter";

import { SigilMarketsDock } from "./SigilMarketsDock";
import { SigilShareSheet } from "./sigils/SigilShareSheet";
import { useSigilMarketsPositionStore } from "./state/positionStore";

// Sheet stack renderers (minimal, but makes the experience actually work)
import { InhaleGlyphGate } from "./sigils/InhaleGlyphGate";
import { SealPredictionSheet } from "./views/Prophecy/SealPredictionSheet";

export type SigilMarketsRoutesProps = Readonly<{
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

const SheetsLayer = (props: Readonly<{ now: KaiMoment }>) => {
  const { state, actions } = useSigilMarketsUi();
  const { state: posState } = useSigilMarketsPositionStore();
  const top = state.sheets.length > 0 ? state.sheets[state.sheets.length - 1].payload : null;

  if (!top) return null;

  const close = (): void => actions.popSheet();

  if (top.id === "inhale-glyph") {
    return (
      <InhaleGlyphGate
        open
        onClose={close}
        now={props.now}
        reason={top.reason}
        marketId={top.marketId}
      />
    );
  }

  if (top.id === "seal-prediction") {
    return (
      <SealPredictionSheet
        open
        onClose={close}
        now={props.now}
        initialMarketId={(top.marketId ?? null) as MarketId | null}
      />
    );
  }

  if (top.id === "share-sigil") {
    const refId = top.refId;
    // MVP: support position share by positionId
    const pos = posState.byId[refId] ?? null;
    const svgUrl = pos?.sigil?.url;

    return (
      <SigilShareSheet
        open
        onClose={close}
        title="Share sigil"
        filenameBase={`sigil-${refId}`}
        svgUrl={svgUrl}
        svgText={pos?.sigil?.svg}
      />
    );
  }

  // Other sheets are rendered locally for now (MarketRoom, Vault, Positions).
  // We’ll centralize them here later once every sheet is fully wired.
  return null;
};

export const SigilMarketsRoutes = (props: SigilMarketsRoutesProps) => {
  const { state } = useSigilMarketsUi();
  const route = state.route;

  const content = useMemo(() => {
    switch (route.view) {
      case "grid":
        return <MarketGrid now={props.now} scrollMode={props.scrollMode} scrollRef={props.scrollRef} />;

      case "market":
        return (
          <MarketRoom
            marketId={route.marketId}
            now={props.now}
            scrollMode={props.scrollMode}
            scrollRef={props.scrollRef}
          />
        );

      case "vault":
        return (
          <VaultPanel
            vaultId={route.vaultId}
            now={props.now}
            scrollMode={props.scrollMode}
            scrollRef={props.scrollRef}
          />
        );

      case "positions":
        return <PositionsHome now={props.now} scrollMode={props.scrollMode} scrollRef={props.scrollRef} />;

      case "position":
        return (
          <PositionDetail
            positionId={route.positionId}
            now={props.now}
            scrollMode={props.scrollMode}
            scrollRef={props.scrollRef}
          />
        );
        

      case "prophecy":
        return <ProphecyFeed now={props.now} scrollMode={props.scrollMode} scrollRef={props.scrollRef} />;

      case "resolution":
        return (
          <ResolutionCenter
            marketId={route.marketId}
            now={props.now}
            scrollMode={props.scrollMode}
            scrollRef={props.scrollRef}
          />
        );

      default: {
        // exhaustive
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _never: never = route;
        return <MarketGrid now={props.now} scrollMode={props.scrollMode} scrollRef={props.scrollRef} />;
      }
    }
  }, [props.now, props.scrollMode, props.scrollRef, route]);

  return (
    <div className="sm-routes" data-sm="routes">
      {content}
      <SigilMarketsDock now={props.now} />
      <SheetsLayer now={props.now} />
    </div>
  );
};
