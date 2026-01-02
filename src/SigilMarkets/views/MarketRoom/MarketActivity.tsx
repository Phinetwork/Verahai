import { Card } from '../../ui/atoms/Card';

export const MarketActivity = () => {
  return (
    <Card className="sm-activity">
      <h4>Live activity</h4>
      <ul>
        <li>Vault guild locked 120 Veras · 2m ago</li>
        <li>Oracle Kai pinged confidence +3% · 5m ago</li>
        <li>Sigil mint queued for Kai-001 · 12m ago</li>
      </ul>
    </Card>
  );
};
