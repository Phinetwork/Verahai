import { Button } from '../../ui/atoms/Button';

export const VaultActions = ({ onOpen }: { onOpen: () => void }) => {
  return (
    <div className="sm-vault__actions">
      <Button onClick={onOpen}>Deposit</Button>
      <Button tone="ghost" onClick={onOpen}>Withdraw</Button>
    </div>
  );
};
