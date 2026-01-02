import { useState } from 'react';
import { useMarketStore } from '../../state/marketStore';
import { useMarketGrid } from '../../hooks/useMarketGrid';
import { MarketCell } from './MarketCell';
import { MarketGridEmpty } from './MarketGridEmpty';
import { MarketGridSkeleton } from './MarketGridSkeleton';
import { MarketFilters } from './MarketFilters';
import { MarketSearch } from './MarketSearch';

export const MarketGrid = () => {
  const { markets } = useMarketStore();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const visible = useMarketGrid(markets, query, filter);

  if (markets.length === 0) {
    return <MarketGridSkeleton />;
  }

  return (
    <section className="sm-grid">
      <MarketSearch value={query} onChange={setQuery} />
      <MarketFilters value={filter} onChange={setFilter} />
      {visible.length === 0 ? (
        <MarketGridEmpty />
      ) : (
        <div className="sm-grid__cells">
          {visible.map((market) => (
            <MarketCell key={market.id} market={market} />
          ))}
        </div>
      )}
    </section>
  );
};
