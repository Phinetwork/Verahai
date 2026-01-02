import { useState } from 'react';
import type { MarketSummary } from '../../types/marketTypes';
import { Button } from '../../ui/atoms/Button';
import { YesNoToggle } from './YesNoToggle';
import { StakeSlider } from './StakeSlider';
import { QuotePreview } from './QuotePreview';
import { LockConfirmSheet } from './LockConfirmSheet';
import { MintPositionSheet } from './MintPositionSheet';

export const MarketOrderPanel = ({ market }: { market: MarketSummary }) => {
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [stake, setStake] = useState(200);
  const [isConfirming, setConfirming] = useState(false);
  const [isMinting, setMinting] = useState(false);

  return (
    <div className="sm-room__panel">
      <YesNoToggle value={side} onChange={setSide} />
      <StakeSlider value={stake} onChange={setStake} />
      <QuotePreview market={market} stake={stake} side={side} />
      <div className="sm-room__panel-actions">
        <Button onClick={() => setConfirming(true)}>Lock quote</Button>
        <Button tone="glass" onClick={() => setMinting(true)}>
          Mint sigil
        </Button>
      </div>
      {isConfirming && <LockConfirmSheet onClose={() => setConfirming(false)} />}
      {isMinting && <MintPositionSheet onClose={() => setMinting(false)} />}
    </div>
  );
};
