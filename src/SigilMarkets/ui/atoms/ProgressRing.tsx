interface ProgressRingProps {
  value: number;
}

export const ProgressRing = ({ value }: ProgressRingProps) => {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - value * circumference;

  return (
    <svg className="sm-progress" width="48" height="48" viewBox="0 0 48 48">
      <circle className="sm-progress__bg" cx="24" cy="24" r={radius} />
      <circle
        className="sm-progress__value"
        cx="24"
        cy="24"
        r={radius}
        style={{ strokeDasharray: circumference, strokeDashoffset: progress }}
      />
    </svg>
  );
};
