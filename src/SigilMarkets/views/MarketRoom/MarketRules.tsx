import { Card } from '../../ui/atoms/Card';

export const MarketRules = () => {
  return (
    <Card className="sm-rules">
      <h4>Market rules</h4>
      <ol>
        <li>Oracle consensus required for final resolution.</li>
        <li>Positions are non-transferable until lock ends.</li>
        <li>Vault safety buffer at 10% of liquidity.</li>
      </ol>
    </Card>
  );
};
