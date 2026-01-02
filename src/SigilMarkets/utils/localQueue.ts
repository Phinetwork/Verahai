const queueKey = 'verahai-queue';

export const enqueue = (item: string) => {
  const existing = JSON.parse(localStorage.getItem(queueKey) ?? '[]') as string[];
  existing.push(item);
  localStorage.setItem(queueKey, JSON.stringify(existing));
};

export const flushQueue = () => {
  localStorage.removeItem(queueKey);
};
