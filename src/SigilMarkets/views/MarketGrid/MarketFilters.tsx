import { FilterRow } from '../../ui/chrome/FilterRow';

interface MarketFiltersProps {
  value: string;
  onChange: (value: string) => void;
}

export const MarketFilters = ({ value, onChange }: MarketFiltersProps) => {
  return <FilterRow value={value} onChange={onChange} />;
};
