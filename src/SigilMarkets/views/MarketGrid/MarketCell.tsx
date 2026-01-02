import { useMarketStore } from '../../state/marketStore';
import type { MarketSummary } from '../../types/marketTypes';
import { Card } from '../../ui/atoms/Card';
import { Chip } from '../../ui/atoms/Chip';
import { ProgressRing } from '../../ui/atoms/ProgressRing';
import { formatPercent } from '../../utils/format';
import { riskLabel } from '../../utils/risk';

interface MarketCellProps {
  market: MarketSummary;
}

export const MarketCell = ({ market }: MarketCellProps) => {
  const setActiveMarket = useMarketStore((state) => state.setActiveMarket);

  return (
    <Card className="sm-market-cell" onClick={() => setActiveMarket(market.id)}>
      <div>
        <div className="sm-market-cell__title">{market.title}</div>
        <div className="sm-market-cell__subtitle">{market.category}</div>
      </div>
      <div className="sm-market-cell__row">
        <Chip tone={market.status === 'open' ? 'success' : 'warning'}>{market.status}</Chip>
        <span className="sm-market-cell__volume">${market.volume.toLocaleString()} vol</span>
      </div>
      <div className="sm-market-cell__prices">
        <span>Yes {formatPercent(market.yesPrice)}</span>
        <span>No {formatPercent(market.noPrice)}</span>
      </div>
      <div className="sm-market-cell__footer">
        <div>
          <div className="sm-market-cell__oracle">{market.oracle.icon} {market.oracle.name}</div>
          <div className="sm-market-cell__risk">{riskLabel(market.confidence)}</div>
        </div>
        <ProgressRing value={market.confidence} />
      </div>
    </Card>
  );
};
