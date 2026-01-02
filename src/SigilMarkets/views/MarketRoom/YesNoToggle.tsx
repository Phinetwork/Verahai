import clsx from 'clsx';

interface YesNoToggleProps {
  value: 'yes' | 'no';
  onChange: (value: 'yes' | 'no') => void;
}

export const YesNoToggle = ({ value, onChange }: YesNoToggleProps) => {
  return (
    <div className="sm-yesno">
      {(['yes', 'no'] as const).map((option) => (
        <button
          key={option}
          className={clsx('sm-yesno__option', value === option && 'is-active')}
          onClick={() => onChange(option)}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
};
