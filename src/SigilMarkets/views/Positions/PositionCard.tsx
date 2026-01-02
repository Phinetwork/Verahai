import type { SigilPosition } from '../../types/sigilPositionTypes';
import { Card } from '../../ui/atoms/Card';

export const PositionCard = ({ position, onSelect }: { position: SigilPosition; onSelect: (id: string) => void }) => {
  return (
    <Card className="sm-position-card" onClick={() => onSelect(position.id)}>
      <div className="sm-position-card__title">{position.outcome.toUpperCase()} stake</div>
      <div className="sm-position-card__value">${position.stake}</div>
      <div className="sm-position-card__status">{position.status}</div>
    </Card>
  );
};
