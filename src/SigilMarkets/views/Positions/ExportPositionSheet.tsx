import { Sheet } from '../../ui/atoms/Sheet';
import { Button } from '../../ui/atoms/Button';

export const ExportPositionSheet = ({ onClose }: { onClose: () => void }) => {
  return (
    <Sheet className="sm-sheet--modal">
      <h3>Export position</h3>
      <p>Create a sigil proof package for external sharing.</p>
      <div className="sm-sheet__actions">
        <Button onClick={onClose}>Export</Button>
        <Button tone="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
};
