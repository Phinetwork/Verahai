import { Card } from '../../ui/atoms/Card';

export const MarketGridSkeleton = () => {
  return (
    <div className="sm-grid__skeleton">
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index} className="sm-skeleton" />
      ))}
    </div>
  );
};
