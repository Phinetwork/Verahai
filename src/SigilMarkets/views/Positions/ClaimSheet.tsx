import { Sheet } from '../../ui/atoms/Sheet';
import { Button } from '../../ui/atoms/Button';

export const ClaimSheet = ({ onClose }: { onClose: () => void }) => {
  return (
    <Sheet className="sm-sheet--modal">
      <h3>Claim rewards</h3>
      <p>Release your Verahai yield into the vault balance.</p>
      <div className="sm-sheet__actions">
        <Button onClick={onClose}>Claim now</Button>
        <Button tone="ghost" onClick={onClose}>Later</Button>
      </div>
    </Sheet>
  );
};
