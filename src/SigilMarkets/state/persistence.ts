export const hydrateFromStorage = <T>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const persistToStorage = <T>(key: string, value: T) => {
  localStorage.setItem(key, JSON.stringify(value));
};
