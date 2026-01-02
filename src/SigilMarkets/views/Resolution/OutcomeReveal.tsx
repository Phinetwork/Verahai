import { WinBurst } from '../../ui/motion/WinBurst';

export const OutcomeReveal = () => {
  return (
    <div className="sm-resolution__outcome">
      <WinBurst />
      <div>
        <div className="sm-resolution__label">Latest outcome</div>
        <div className="sm-resolution__value">Kai-003 resolved YES</div>
      </div>
    </div>
  );
};
