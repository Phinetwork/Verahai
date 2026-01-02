import type { SigilPosition } from '../types/sigilPositionTypes';

export const fetchPositions = async (): Promise<SigilPosition[]> => {
  return [
    {
      id: 'pos-1',
      marketId: 'kai-001',
      outcome: 'yes',
      stake: 420,
      createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      potentialReturn: 686,
      status: 'active'
    },
    {
      id: 'pos-2',
      marketId: 'kai-002',
      outcome: 'no',
      stake: 300,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
      potentialReturn: 510,
      status: 'active'
    }
  ];
};
