import { Segmented } from '../atoms/Segmented';

interface FilterRowProps {
  value: string;
  onChange: (value: string) => void;
}

export const FilterRow = ({ value, onChange }: FilterRowProps) => {
  return (
    <div className="sm-filter-row">
      <Segmented options={['all', 'open', 'locked', 'resolved']} value={value} onChange={onChange} />
    </div>
  );
};
