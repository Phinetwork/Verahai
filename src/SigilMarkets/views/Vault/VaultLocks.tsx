import { Card } from '../../ui/atoms/Card';

export const VaultLocks = () => {
  return (
    <Card className="sm-vault__locks">
      <div className="sm-vault__label">Active locks</div>
      <div className="sm-vault__value">42</div>
      <div className="sm-vault__hint">Next release in 3h</div>
    </Card>
  );
};
