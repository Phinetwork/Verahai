import { Sheet } from '../../ui/atoms/Sheet';
import { Button } from '../../ui/atoms/Button';

export const LockConfirmSheet = ({ onClose }: { onClose: () => void }) => {
  return (
    <Sheet className="sm-sheet--modal">
      <h3>Lock sigil quote</h3>
      <p>Secure this Kairos quote for 30 seconds while your glyph syncs.</p>
      <div className="sm-sheet__actions">
        <Button onClick={onClose}>Confirm lock</Button>
        <Button tone="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
};
