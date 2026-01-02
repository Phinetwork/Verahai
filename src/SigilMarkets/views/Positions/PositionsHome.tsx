import { PositionCard } from './PositionCard';
import { PositionDetail } from './PositionDetail';
import { PositionTimeline } from './PositionTimeline';
import { ClaimSheet } from './ClaimSheet';
import { ExportPositionSheet } from './ExportPositionSheet';
import { TransferPositionSheet } from './TransferPositionSheet';
import { usePositions } from '../../hooks/usePositions';
import { useState } from 'react';

export const PositionsHome = () => {
  const positions = usePositions();
  const [active, setActive] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'claim' | 'export' | 'transfer' | null>(null);
  const selected = positions.find((pos) => pos.id === active) ?? positions[0] ?? null;

  return (
    <section className="sm-positions">
      <div className="sm-positions__grid">
        {positions.map((position) => (
          <PositionCard key={position.id} position={position} onSelect={setActive} />
        ))}
      </div>
      {selected && (
        <div className="sm-positions__detail">
          <PositionDetail position={selected} onAction={setSheet} />
          <PositionTimeline />
        </div>
      )}
      {sheet === 'claim' && <ClaimSheet onClose={() => setSheet(null)} />}
      {sheet === 'export' && <ExportPositionSheet onClose={() => setSheet(null)} />}
      {sheet === 'transfer' && <TransferPositionSheet onClose={() => setSheet(null)} />}
    </section>
  );
};
