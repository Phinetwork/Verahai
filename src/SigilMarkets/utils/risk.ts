export const riskLabel = (confidence: number) => {
  if (confidence > 0.82) return 'High conviction';
  if (confidence > 0.6) return 'Focused';
  return 'Speculative';
};
