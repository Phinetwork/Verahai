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

  // Destructure to keep hooks deps clean and avoid exhaustive-deps warnings.
  const { items, filteredCount, totalCount, filters, prefs } = grid;
  type GridItem = (typeof items)[number];

  useScrollRestoration(ui.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const subtitle = useMemo(() => {
    if (totalCount === 0) return "Loading markets…";
    if (filteredCount === totalCount) return `${totalCount} markets`;
    return `${filteredCount} of ${totalCount}`;
  }, [filteredCount, totalCount]);

  const showEmpty = totalCount > 0 && filteredCount === 0;

  const grouped = useMemo((): ReadonlyMap<MarketCategory, readonly GridItem[]> => {
    // Use mutable arrays internally, then expose readonly arrays.
    const map = new Map<MarketCategory, GridItem[]>();
    for (const cat of MARKET_CATEGORIES) map.set(cat, []);

    for (const it of items) {
      const cat = it.market.def.category as MarketCategory;
      const list = map.get(cat);
      if (list) list.push(it);
    }

    // Freeze outward type (readonly) so callers can't mutate.
    const out = new Map<MarketCategory, readonly GridItem[]>();
    for (const [cat, list] of map.entries()) out.set(cat, list);
    return out;
  }, [items]);

  const availableCategories = useMemo(
    () => MARKET_CATEGORIES.filter((cat) => (grouped.get(cat)?.length ?? 0) > 0),
    [grouped],
  );

  const [openCategories, setOpenCategories] = useState<Set<MarketCategory>>(new Set());

  const openKey = useMemo(() => {
    const activeKey = filters.categories.join("|");
    const availableKey = availableCategories.join("|");
    return `${activeKey}::${availableKey}`;
  }, [availableCategories, filters.categories]);

  useEffect(() => {
    const next = new Set<MarketCategory>();
    if (filters.categories.length > 0) {
      filters.categories.forEach((cat) => next.add(cat));
    } else {
      availableCategories.forEach((cat) => next.add(cat));
    }
    setOpenCategories(next);
  }, [openKey]);

  const toggleCategory = (cat: MarketCategory): void => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
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

      {totalCount === 0 ? (
        <MarketGridSkeleton />
      ) : showEmpty ? (
        <MarketGridEmpty />
      ) : (
        <div className="sm-market-sections">
          {availableCategories.map((cat) => {
            const catItems = grouped.get(cat) ?? [];
            if (catItems.length === 0) return null;

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
                  <span className="sm-market-section-count">{catItems.length}</span>
                  <span className="sm-market-section-icon" aria-hidden="true">
                    {isOpen ? "–" : "+"}
                  </span>
                </button>

                <div className="sm-market-section-body" hidden={!isOpen}>
                  <div className={`sm-grid ${prefs.layout === "list" ? "is-list" : "is-honeycomb"}`}>
                    {catItems.map((it) => (
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
