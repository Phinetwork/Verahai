import { BottomNav } from './ui/chrome/BottomNav';
import { FloatingAction } from './ui/chrome/FloatingAction';

export const SigilMarketsDock = () => {
  return (
    <div className="sm-dock">
      <FloatingAction />
      <BottomNav />
    </div>
  );
};
