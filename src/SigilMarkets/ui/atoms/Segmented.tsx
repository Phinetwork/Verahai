import clsx from 'clsx';

interface SegmentedProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}

export const Segmented = ({ options, value, onChange }: SegmentedProps) => {
  return (
    <div className="sm-segmented">
      {options.map((option) => (
        <button
          key={option}
          className={clsx('sm-segmented__item', value === option && 'is-active')}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
};
