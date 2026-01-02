import { Button } from '../../ui/atoms/Button';

export const ProphecyComposer = () => {
  return (
    <div className="sm-prophecy__composer">
      <div>
        <div className="sm-prophecy__title">Speak to Kairos</div>
        <div className="sm-prophecy__subtitle">Share a new sigil pulse with the network.</div>
      </div>
      <Button tone="glass">Create prophecy</Button>
    </div>
  );
};
