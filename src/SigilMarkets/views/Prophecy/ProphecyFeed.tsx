import { ProphecyComposer } from './ProphecyComposer';
import { ProphecyCard } from './ProphecyCard';
import { ProphecyLeaderboard } from './ProphecyLeaderboard';
import { CreatorBadges } from './CreatorBadges';
import { useProphecyFeed } from '../../hooks/useProphecyFeed';

export const ProphecyFeed = () => {
  const signals = useProphecyFeed();

  return (
    <section className="sm-prophecy">
      <ProphecyComposer />
      <div className="sm-prophecy__grid">
        {signals.map((signal) => (
          <ProphecyCard key={signal.id} signal={signal} />
        ))}
      </div>
      <div className="sm-prophecy__row">
        <ProphecyLeaderboard />
        <CreatorBadges />
      </div>
    </section>
  );
};
