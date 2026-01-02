interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export const SearchBar = ({ value, onChange }: SearchBarProps) => {
  return (
    <label className="sm-search">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search prophecy markets"
      />
      <span>⌕</span>
    </label>
  );
};
