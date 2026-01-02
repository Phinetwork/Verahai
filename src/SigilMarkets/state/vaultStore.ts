import { create } from 'zustand';
import type { VaultSnapshot } from '../types/vaultTypes';

interface VaultState {
  vault: VaultSnapshot | null;
  setVault: (vault: VaultSnapshot) => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  vault: null,
  setVault: (vault) => set({ vault })
}));
