// SigilMarkets/views/MarketGrid/MarketSearch.tsx
"use client";

import { useSigilMarketsUi } from "../../state/uiStore";
import { SearchBar } from "../../ui/chrome/SearchBar";

export const MarketSearch = () => {
  const { state, actions } = useSigilMarketsUi();
  return (
    <SearchBar
      value={state.grid.filters.query}
      onChange={(q) => actions.setGridQuery(q)}
      placeholder="Search markets…"
    />
  );
};
