import { Card } from '../../ui/atoms/Card';
import { useVault } from '../../hooks/useVault';

export const VaultSigilCard = () => {
  const vault = useVault();

  return (
    <Card className="sm-vault__sigil">
      <div>🜂</div>
      <div>
        <div className="sm-vault__title">{vault?.label ?? 'Verahai Vault'}</div>
        <div className="sm-vault__subtitle">Kairos guarded liquidity</div>
      </div>
    </Card>
  );
};
