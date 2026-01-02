import { useVaultStore } from '../state/vaultStore';

export const useVault = () => {
  return useVaultStore((state) => state.vault);
};
