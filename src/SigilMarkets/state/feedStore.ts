import { create } from 'zustand';
import type { OracleSignal } from '../types/oracleTypes';

interface FeedState {
  signals: OracleSignal[];
  setSignals: (signals: OracleSignal[]) => void;
}

export const useFeedStore = create<FeedState>((set) => ({
  signals: [],
  setSignals: (signals) => set({ signals })
}));
