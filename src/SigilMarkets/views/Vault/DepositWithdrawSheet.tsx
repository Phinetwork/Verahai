import { Sheet } from '../../ui/atoms/Sheet';
import { Button } from '../../ui/atoms/Button';

export const DepositWithdrawSheet = ({ onClose }: { onClose: () => void }) => {
  return (
    <Sheet className="sm-sheet--modal">
      <h3>Vault transfer</h3>
      <p>Move Verahai tokens into or out of the protected vault stream.</p>
      <div className="sm-sheet__actions">
        <Button onClick={onClose}>Confirm transfer</Button>
        <Button tone="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
};
