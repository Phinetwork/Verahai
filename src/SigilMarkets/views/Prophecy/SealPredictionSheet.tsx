import { Sheet } from '../../ui/atoms/Sheet';
import { Button } from '../../ui/atoms/Button';

export const SealPredictionSheet = ({ onClose }: { onClose: () => void }) => {
  return (
    <Sheet className="sm-sheet--modal">
      <h3>Seal prophecy</h3>
      <p>Lock your prediction and share a sigil glyph to the feed.</p>
      <div className="sm-sheet__actions">
        <Button onClick={onClose}>Seal now</Button>
        <Button tone="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
};
