import { useEffect, useState } from 'react';

const formatKai = (date: Date) => {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export const useKaiNow = () => {
  const [now, setNow] = useState(formatKai(new Date()));

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(formatKai(new Date()));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return now;
};
