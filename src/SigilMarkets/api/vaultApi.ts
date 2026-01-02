import type { VaultSnapshot } from '../types/vaultTypes';

export const fetchVault = async (): Promise<VaultSnapshot> => {
  return {
    id: 'vault-core',
    label: 'Verahai Core Vault',
    balance: 128_430.52,
    streak: 7,
    apy: 14.4,
    lastUpdated: new Date().toISOString()
  };
};
