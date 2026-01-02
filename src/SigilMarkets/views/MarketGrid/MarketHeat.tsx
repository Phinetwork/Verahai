import { formatPercent } from '../../utils/format';

interface MarketHeatProps {
  value: number;
}

export const MarketHeat = ({ value }: MarketHeatProps) => {
  return <span className="sm-heat">{formatPercent(value)} heat</span>;
};
