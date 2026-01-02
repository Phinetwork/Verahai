import { Card } from '../../ui/atoms/Card';
import { useVault } from '../../hooks/useVault';
import { formatCurrency } from '../../utils/format';

export const VaultBalance = () => {
  const vault = useVault();

  return (
    <Card className="sm-vault__balance">
      <div className="sm-vault__label">Vault balance</div>
      <div className="sm-vault__value">{vault ? formatCurrency(vault.balance) : '--'}</div>
      <div className="sm-vault__apy">APY {vault?.apy ?? '--'}%</div>
    </Card>
  );
};
