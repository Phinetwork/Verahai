import { Sheet } from '../../ui/atoms/Sheet';
import { Button } from '../../ui/atoms/Button';

export const TransferPositionSheet = ({ onClose }: { onClose: () => void }) => {
  return (
    <Sheet className="sm-sheet--modal">
      <h3>Transfer position</h3>
      <p>Send this sigil position to another vault alias.</p>
      <div className="sm-sheet__actions">
        <Button onClick={onClose}>Transfer</Button>
        <Button tone="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
};
