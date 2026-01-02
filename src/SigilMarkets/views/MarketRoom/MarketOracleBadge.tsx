import { Card } from '../../ui/atoms/Card';
import type { MarketOracle } from '../../types/marketTypes';

interface MarketOracleBadgeProps {
  oracle: MarketOracle;
  confidence: number;
}

export const MarketOracleBadge = ({ oracle, confidence }: MarketOracleBadgeProps) => {
  return (
    <Card className="sm-oracle">
      <div className="sm-oracle__icon">{oracle.icon}</div>
      <div>
        <div className="sm-oracle__title">{oracle.name}</div>
        <div className="sm-oracle__subtitle">Trust {Math.round(oracle.trustScore * 100)}%</div>
      </div>
      <div className="sm-oracle__confidence">{Math.round(confidence * 100)}% aligned</div>
    </Card>
  );
};
