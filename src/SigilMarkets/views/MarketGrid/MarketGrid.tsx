// SigilMarkets/views/MarketGrid/MarketGrid.tsx
"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import type { KaiMoment, MarketCategory } from "../../types/marketTypes";
import { useMarketGrid } from "../../hooks/useMarketGrid";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { MARKET_CATEGORIES, labelForCategory } from "../../constants/marketCategories";

import { TopBar } from "../../ui/chrome/TopBar";
import { MarketCell } from "./MarketCell";
import { MarketFilters } from "./MarketFilters";
import { MarketGridEmpty } from "./MarketGridEmpty";
import { MarketGridSkeleton } from "./MarketGridSkeleton";

export type MarketGridProps = Readonly<{
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: RefObject<HTMLDivElement | null> | null;
}>;

export const MarketGrid = (props: MarketGridProps) => {
  const { state: ui } = useSigilMarketsUi();

  const grid = useMarketGrid(props.now.pulse);

  useScrollRestoration(ui.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const subtitle = useMemo(() => {
    const f = grid.filteredCount;
    const t = grid.totalCount;
    if (t === 0) return "Loading markets…";
    if (f === t) return `${t} markets`;
    return `${f} of ${t}`;
  }, [grid.filteredCount, grid.totalCount]);

  const showEmpty = grid.totalCount > 0 && grid.filteredCount === 0;

  const grouped = useMemo(() => {
    const map = new Map<MarketCategory, typeof grid.items>();
    for (const cat of MARKET_CATEGORIES) map.set(cat, []);
    for (const item of grid.items) {
      const list = map.get(item.market.def.category as MarketCategory);
      if (list) list.push(item);
    }
    return map;
  }, [grid.items]);

  const availableCategories = useMemo(
    () => MARKET_CATEGORIES.filter((cat) => (grouped.get(cat)?.length ?? 0) > 0),
    [grouped],
  );

  const [openCategories, setOpenCategories] = useState<Set<MarketCategory>>(new Set());

  const openKey = useMemo(() => {
    const activeKey = grid.filters.categories.join("|");
    const availableKey = availableCategories.join("|");
    return `${activeKey}::${availableKey}`;
  }, [availableCategories, grid.filters.categories]);

  useEffect(() => {
    const next = new Set<MarketCategory>();
    if (grid.filters.categories.length > 0) {
      grid.filters.categories.forEach((cat) => next.add(cat));
    } else {
      availableCategories.forEach((cat) => next.add(cat));
    }
    setOpenCategories(next);
  }, [openKey, availableCategories, grid.filters.categories]);

  const toggleCategory = (cat: MarketCategory): void => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  return (
    <div className="sm-page sm-honeycomb-page" data-sm="market-grid">
      <TopBar
        title="Vérahai"
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
        <div className="sm-market-sections">
          {availableCategories.map((cat) => {
            const items = grouped.get(cat) ?? [];
            if (items.length === 0) return null;
            const isOpen = openCategories.has(cat);

            return (
              <section key={cat} className={`sm-market-section ${isOpen ? "is-open" : "is-closed"}`}>
                <button
                  type="button"
                  className="sm-market-section-toggle"
                  aria-expanded={isOpen}
                  onClick={() => toggleCategory(cat)}
                >
                  <span className="sm-market-section-title">{labelForCategory(cat)}</span>
                  <span className="sm-market-section-count">{items.length}</span>
                  <span className="sm-market-section-icon" aria-hidden="true">
                    {isOpen ? "–" : "+"}
                  </span>
                </button>
                <div className="sm-market-section-body" hidden={!isOpen}>
                  <div className={`sm-grid ${grid.prefs.layout === "list" ? "is-list" : "is-honeycomb"}`}>
                    {items.map((it) => (
                      <MarketCell key={it.marketId as unknown as string} {...it} />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
