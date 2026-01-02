// SigilMarkets/views/MarketGrid/MarketGrid.tsx
"use client";

import React, { useMemo } from "react";
import type { KaiMoment, MarketId } from "../../types/marketTypes";
import { useMarketGrid } from "../../hooks/useMarketGrid";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { useHaptics } from "../../hooks/useHaptics";
import { useSfx } from "../../hooks/useSfx";

import { TopBar } from "../../ui/chrome/TopBar";
import { MarketCell } from "./MarketCell";
import { MarketFilters } from "./MarketFilters";
import { MarketGridEmpty } from "./MarketGridEmpty";
import { MarketGridSkeleton } from "./MarketGridSkeleton";

export type MarketGridProps = Readonly<{
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

export const MarketGrid = (props: MarketGridProps) => {
  const { state: ui, actions } = useSigilMarketsUi();
  const haptics = useHaptics();
  const sfx = useSfx();

  const grid = useMarketGrid(props.now.pulse);

  useScrollRestoration(ui.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const onSelectMarket = (marketId: MarketId): void => {
    haptics.fire("tap");
    sfx.play("tap");
    actions.navigate({ view: "market", marketId });
  };

  const subtitle = useMemo(() => {
    const f = grid.filteredCount;
    const t = grid.totalCount;
    if (t === 0) return "Loading markets…";
    if (f === t) return `${t} markets`;
    return `${f} of ${t}`;
  }, [grid.filteredCount, grid.totalCount]);

  const showEmpty = grid.totalCount > 0 && grid.filteredCount === 0;

  return (
    <div className="sm-page" data-sm="market-grid">
      <TopBar
        title="Sigil Markets"
        subtitle={subtitle}
        now={props.now}
        scrollMode={props.scrollMode}
        scrollRef={props.scrollRef}
      />

      <div className="sm-grid-head">
        <MarketFilters now={props.now} />
      </div>

      {grid.totalCount === 0 ? (
        <MarketGridSkeleton />
      ) : showEmpty ? (
        <MarketGridEmpty />
      ) : (
        <div className={`sm-grid ${grid.prefs.layout === "list" ? "is-list" : "is-honeycomb"}`}>
          {grid.items.map((it) => (
            <MarketCell
              key={it.marketId as unknown as string}
              item={it}
              onOpen={() => onSelectMarket(it.marketId)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
