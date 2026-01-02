import { create } from 'zustand';
import type { SigilPosition } from '../types/sigilPositionTypes';

interface PositionState {
  positions: SigilPosition[];
  setPositions: (positions: SigilPosition[]) => void;
}

export const usePositionStore = create<PositionState>((set) => ({
  positions: [],
  setPositions: (positions) => set({ positions })
}));
