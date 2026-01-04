// SigilMarkets/SigilMarketsRoutes.tsx
"use client";

import { useMemo, type RefObject } from "react";
import type { KaiMoment, VaultId } from "./types/marketTypes";
import { useSigilMarketsUi } from "./state/uiStore";

import { MarketGrid } from "./views/MarketGrid/MarketGrid";
import { MarketRoom } from "./views/MarketRoom/MarketRoom";
import { VaultPanel } from "./views/Vault/VaultPanel";
import { PositionsHome } from "./views/Positions/PositionsHome";
import { PositionDetail } from "./views/Positions/PositionDetail";
import { ProphecyFeed } from "./views/Prophecy/ProphecyFeed";
import { ResolutionCenter } from "./views/Resolution/ResolutionCenter";

import { SigilMarketsDock } from "./SigilMarketsDock";
import { SigilHowTo } from "./SigilHowTo";
import { SigilShareSheet } from "./sigils/SigilShareSheet";
import { useSigilMarketsPositionStore } from "./state/positionStore";
import { useVaultById } from "./state/vaultStore";

import { InhaleGlyphGate } from "./sigils/InhaleGlyphGate";
import { SealPredictionSheet } from "./views/Prophecy/SealPredictionSheet";
import { DepositWithdrawSheet } from "./views/Vault/DepositWithdrawSheet";

export type SigilMarketsRoutesProps = Readonly<{
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: RefObject<HTMLDivElement | null> | null;
}>;

const SheetsLayer = (props: Readonly<{ now: KaiMoment }>) => {
  const { state, actions } = useSigilMarketsUi();
  const { state: posState } = useSigilMarketsPositionStore();

  const top = state.sheets.length > 0 ? state.sheets[state.sheets.length - 1].payload : null;
  const vaultIdForSheet =
    top && top.id === "deposit-withdraw" ? top.vaultId : ("__none__" as unknown as VaultId);
  const depositVault = useVaultById(vaultIdForSheet);
  if (!top) return null;

  const close = (): void => actions.popSheet();

  if (top.id === "inhale-glyph") {
    return <InhaleGlyphGate open onClose={close} now={props.now} reason={top.reason} marketId={top.marketId} />;
  }

  if (top.id === "seal-prediction") {
    return <SealPredictionSheet open onClose={close} now={props.now} initialMarketId={top.marketId ?? null} />;
  }

  if (top.id === "deposit-withdraw") {
    if (!depositVault) return null;
    return (
      <DepositWithdrawSheet
        open
        onClose={close}
        mode={top.mode ?? "deposit"}
        vault={depositVault}
        now={props.now}
      />
    );
  }

  if (top.id === "share-sigil") {
    const refId = top.refId;

    const pos = posState.byId[refId] ?? null;
    const svgUrl = pos?.sigil?.url;

    return (
      <SigilShareSheet
        open
        onClose={close}
        title="Share sigil"
        filenameBase={`sigil-${refId}`}
        svgUrl={svgUrl}
      />
    );
  }

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
        return <PositionDetail positionId={route.positionId} now={props.now} scrollMode={props.scrollMode} scrollRef={props.scrollRef} />;

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

      default:
        // Defensive fallback (should never happen)
        return <MarketGrid now={props.now} scrollMode={props.scrollMode} scrollRef={props.scrollRef} />;
    }
  }, [props.now, props.scrollMode, props.scrollRef, route]);

  return (
    <div className="sm-routes" data-sm="routes">
      {content}
      <SigilHowTo />
      <SigilMarketsDock now={props.now} />
      <SheetsLayer now={props.now} />
    </div>
  );
};
