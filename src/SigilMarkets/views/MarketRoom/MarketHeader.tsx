import type { MarketSummary } from '../../types/marketTypes';
import { Chip } from '../../ui/atoms/Chip';

export const MarketHeader = ({ market }: { market: MarketSummary }) => {
  return (
    <div className="sm-room__header">
      <div>
        <div className="sm-room__title">{market.title}</div>
        <div className="sm-room__subtitle">{market.description}</div>
      </div>
      <Chip tone={market.status === 'open' ? 'success' : 'warning'}>{market.status}</Chip>
    </div>
  );
};
