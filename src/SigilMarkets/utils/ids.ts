export const createId = (prefix: string) => {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
};
