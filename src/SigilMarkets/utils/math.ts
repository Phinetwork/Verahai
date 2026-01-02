export const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};
