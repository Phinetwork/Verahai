import { MarketHeader } from './MarketHeader';
import { MarketCountdown } from './MarketCountdown';
import { MarketChart } from './MarketChart';
import { MarketOrderPanel } from './MarketOrderPanel';
import { MarketActivity } from './MarketActivity';
import { MarketRules } from './MarketRules';
import { MarketOracleBadge } from './MarketOracleBadge';
import { useMarket } from '../../hooks/useMarket';

export const MarketRoom = () => {
  const market = useMarket();

  if (!market) {
    return null;
  }

  return (
    <section className="sm-room">
      <MarketHeader market={market} />
      <MarketCountdown expiresAt={market.expiresAt} />
      <MarketOracleBadge oracle={market.oracle} confidence={market.confidence} />
      <MarketChart market={market} />
      <MarketOrderPanel market={market} />
      <div className="sm-room__split">
        <MarketActivity />
        <MarketRules />
      </div>
    </section>
  );
};
