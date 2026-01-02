import { Sheet } from '../../ui/atoms/Sheet';
import { Button } from '../../ui/atoms/Button';

export const DisputeSheet = ({ onClose }: { onClose: () => void }) => {
  return (
    <Sheet className="sm-sheet--modal">
      <h3>Dispute outcome</h3>
      <p>Submit evidence to the council for review.</p>
      <div className="sm-sheet__actions">
        <Button onClick={onClose}>Submit dispute</Button>
        <Button tone="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
};
