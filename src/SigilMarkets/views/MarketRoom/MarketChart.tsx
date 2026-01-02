import type { MarketSummary } from '../../types/marketTypes';
import { MarketHeat } from '../MarketGrid/MarketHeat';

export const MarketChart = ({ market }: { market: MarketSummary }) => {
  return (
    <div className="sm-room__chart">
      <div className="sm-room__chart-title">Sigil flow</div>
      <div className="sm-room__chart-line" />
      <MarketHeat value={market.confidence} />
    </div>
  );
};
