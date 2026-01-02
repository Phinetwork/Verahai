import type { OracleSignal } from '../../types/oracleTypes';
import { Card } from '../../ui/atoms/Card';

export const ProphecyCard = ({ signal }: { signal: OracleSignal }) => {
  return (
    <Card className="sm-prophecy-card">
      <div className="sm-prophecy-card__title">{signal.title}</div>
      <p>{signal.message}</p>
      <div className="sm-prophecy-card__footer">
        <span>{signal.source}</span>
        <span>{Math.round(signal.confidence * 100)}% aligned</span>
      </div>
    </Card>
  );
};
