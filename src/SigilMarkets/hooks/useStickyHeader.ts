import { useEffect, useState } from 'react';

export const useStickyHeader = () => {
  const [isSticky, setSticky] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setSticky(window.scrollY > 12);
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return isSticky;
};
