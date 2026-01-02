import { create } from 'zustand';
import type { KaiMood } from '../types/uiTypes';

interface UiState {
  mood: KaiMood;
  setMood: (mood: KaiMood) => void;
  isImmersive: boolean;
  toggleImmersive: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mood: 'calm',
  isImmersive: false,
  setMood: (mood) => set({ mood }),
  toggleImmersive: () => set((state) => ({ isImmersive: !state.isImmersive }))
}));
