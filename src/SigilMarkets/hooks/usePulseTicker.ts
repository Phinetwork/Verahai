import { useEffect, useState } from 'react';
import type { PulseState } from '../types/uiTypes';

export const usePulseTicker = () => {
  const [pulse, setPulse] = useState<PulseState>({
    time: new Date().toISOString(),
    kaiMood: 'calm',
    beat: 0
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setPulse((prev) => ({
        time: new Date().toISOString(),
        kaiMood: prev.beat % 3 === 0 ? 'surge' : prev.beat % 2 === 0 ? 'focused' : 'calm',
        beat: prev.beat + 1
      }));
    }, 1600);

    return () => clearInterval(timer);
  }, []);

  return pulse;
};
