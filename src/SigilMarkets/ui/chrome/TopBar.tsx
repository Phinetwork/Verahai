import { PulseSpark } from '../motion/PulseSpark';
import { Button } from '../atoms/Button';
import { useKaiNow } from '../../hooks/useKaiNow';

interface TopBarProps {
  onModeToggle: () => void;
  isImmersive: boolean;
}

export const TopBar = ({ onModeToggle, isImmersive }: TopBarProps) => {
  const now = useKaiNow();

  return (
    <header className="sm-topbar">
      <div>
        <div className="sm-topbar__title">Verahai · SigilMarkets</div>
        <div className="sm-topbar__subtitle">Kairos pulse {now}</div>
      </div>
      <div className="sm-topbar__actions">
        <PulseSpark />
        <Button tone="ghost" onClick={onModeToggle}>
          {isImmersive ? 'Exit glow' : 'Immersive glow'}
        </Button>
      </div>
    </header>
  );
};
