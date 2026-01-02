export const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
};

export const formatPercent = (value: number) => {
  return `${Math.round(value * 100)}%`;
};
