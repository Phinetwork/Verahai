import { Sheet } from '../../ui/atoms/Sheet';
import { Button } from '../../ui/atoms/Button';

export const MintPositionSheet = ({ onClose }: { onClose: () => void }) => {
  return (
    <Sheet className="sm-sheet--modal">
      <h3>Mint Sigil Position</h3>
      <p>Sigil glyph minted to your vault ledger. Ready to share or export.</p>
      <div className="sm-sheet__actions">
        <Button onClick={onClose}>Mint now</Button>
        <Button tone="ghost" onClick={onClose}>Later</Button>
      </div>
    </Sheet>
  );
};
