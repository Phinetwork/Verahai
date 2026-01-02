import type { SigilPosition } from '../../types/sigilPositionTypes';
import { Button } from '../../ui/atoms/Button';

export const PositionDetail = ({ position, onAction }: { position: SigilPosition; onAction: (action: 'claim' | 'export' | 'transfer') => void }) => {
  return (
    <div className="sm-position-detail">
      <h3>Position {position.id}</h3>
      <p>Outcome: {position.outcome.toUpperCase()}</p>
      <p>Potential return: ${position.potentialReturn}</p>
      <div className="sm-position-detail__actions">
        <Button onClick={() => onAction('claim')}>Claim</Button>
        <Button tone="ghost" onClick={() => onAction('export')}>Export</Button>
        <Button tone="glass" onClick={() => onAction('transfer')}>Transfer</Button>
      </div>
    </div>
  );
};
