import type { MarketSummary } from '../../types/marketTypes';
import { formatCurrency } from '../../utils/format';

interface QuotePreviewProps {
  market: MarketSummary;
  stake: number;
  side: 'yes' | 'no';
}

export const QuotePreview = ({ market, stake, side }: QuotePreviewProps) => {
  const price = side === 'yes' ? market.yesPrice : market.noPrice;
  const potential = stake / price;

  return (
    <div className="sm-quote">
      <div>
        <div className="sm-quote__label">Kai quote</div>
        <div className="sm-quote__value">{formatCurrency(potential)}</div>
      </div>
      <div>
        <div className="sm-quote__label">Fill price</div>
        <div className="sm-quote__value">{Math.round(price * 100)}%</div>
      </div>
    </div>
  );
};
