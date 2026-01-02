import { useCallback } from 'react';

export const useSfx = () => {
  const play = useCallback((name: 'tick' | 'win' | 'loss') => {
    const audio = new Audio(`/sfx/${name}.mp3`);
    audio.volume = 0.4;
    void audio.play();
  }, []);

  return { play };
};
