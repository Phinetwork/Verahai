// SigilMarkets/views/MarketGrid/MarketFilters.tsx
"use client";

import type { KaiMoment, MarketCategory, MarketId } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useMarketGrid } from "../../hooks/useMarketGrid";
import { MARKET_CATEGORIES, labelForCategory } from "../../constants/marketCategories";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";

export type MarketFiltersProps = Readonly<{
  now: KaiMoment;
}>;

export const MarketFilters = (props: MarketFiltersProps) => {
  const { state, actions } = useSigilMarketsUi();

  // Use current grid view to pick a reasonable default market when sealing from grid.
  const grid = useMarketGrid(props.now.pulse);

  const active = state.grid.filters.categories;

  const toggleCat = (c: MarketCategory): void => {
    const has = active.includes(c);
    const next = has ? active.filter((x) => x !== c) : [...active, c];
    actions.setCategories(next);
  };

  const layoutIsList = state.grid.prefs.layout === "list";

  const toggleLayout = (): void => {
    actions.setGridLayout(layoutIsList ? "honeycomb" : "list");
  };

  const clear = (): void => {
    actions.setCategories([]);
    actions.setGridQuery("");
  };

  const anyFilters = active.length > 0 || state.grid.filters.query.trim().length > 0;

  const toneFor = (c: MarketCategory): "default" | "cyan" | "violet" | "gold" => {
    if (c === "weather") return "cyan";
    if (c === "crypto") return "violet";
    if (c === "finance") return "gold";
    return "default";
  };

  const openSeal = (): void => {
    // If grid has items, use the first as the default marketId to satisfy SheetPayload contract.
    const first = grid.items.length > 0 ? grid.items[0] : null;

    if (!first) {
      // No markets available: send user to prophecy page (they can pick market there).
      actions.navigate({ view: "prophecy" });
      return;
    }

    const marketId: MarketId = first.marketId;
    actions.pushSheet({ id: "seal-prediction", marketId });
  };

  return (
    <div className="sm-grid-filters">
      <div className="sm-grid-filter-row">
        <button type="button" className="sm-grid-search" onClick={openSeal}>
          <span className="sm-grid-search-ico">
            <Icon name="spark" size={14} tone="gold" />
          </span>
          <span className="sm-grid-search-txt">Seal a prophecy…</span>
        </button>

        <Chip size="sm" selected={layoutIsList} onClick={toggleLayout} left={<Icon name="hex" size={14} tone="dim" />}>
          {layoutIsList ? "List" : "Honey"}
        </Chip>

        {anyFilters ? (
          <Chip size="sm" selected={false} onClick={clear} tone="danger" variant="outline" left={<Icon name="x" size={14} tone="danger" />}>
            Clear
          </Chip>
        ) : null}
      </div>

      <div className="sm-grid-cat-row">
        {MARKET_CATEGORIES.map((c) => (
          <Chip key={c} size="sm" selected={active.includes(c)} tone={toneFor(c)} onClick={() => toggleCat(c)}>
            {labelForCategory(c)}
          </Chip>
        ))}
      </div>
    </div>
  );
};
