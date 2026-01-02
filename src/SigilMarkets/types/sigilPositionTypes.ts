import type { MarketOutcome } from './marketTypes';

export interface SigilPosition {
  id: string;
  marketId: string;
  outcome: MarketOutcome;
  stake: number;
  createdAt: string;
  potentialReturn: number;
  status: 'active' | 'won' | 'lost';
}
