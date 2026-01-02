interface StakeSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export const StakeSlider = ({ value, onChange }: StakeSliderProps) => {
  return (
    <label className="sm-stake">
      <span>Stake</span>
      <input
        type="range"
        min={50}
        max={1000}
        step={10}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="sm-stake__value">${value}</div>
    </label>
  );
};
