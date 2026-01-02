export const cacheWarmup = async () => {
  return new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
};
