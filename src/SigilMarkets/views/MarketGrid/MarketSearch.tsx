import { SearchBar } from '../../ui/chrome/SearchBar';

interface MarketSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export const MarketSearch = ({ value, onChange }: MarketSearchProps) => {
  return <SearchBar value={value} onChange={onChange} />;
};
