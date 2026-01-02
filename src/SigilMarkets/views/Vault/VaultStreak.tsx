import { Card } from '../../ui/atoms/Card';
import { useVault } from '../../hooks/useVault';

export const VaultStreak = () => {
  const vault = useVault();
  return (
    <Card className="sm-vault__streak">
      <div className="sm-vault__label">Streak</div>
      <div className="sm-vault__value">{vault?.streak ?? '--'} cycles</div>
      <div className="sm-vault__hint">Kairos sync stable</div>
    </Card>
  );
};
