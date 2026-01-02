export type MarketOutcome = 'yes' | 'no';

export type MarketStatus = 'open' | 'locked' | 'resolved';

export interface MarketOracle {
  id: string;
  name: string;
  icon: string;
  trustScore: number;
}

export interface MarketSummary {
  id: string;
  title: string;
  category: string;
  description: string;
  status: MarketStatus;
  yesPrice: number;
  noPrice: number;
  volume: number;
  expiresAt: string;
  oracle: MarketOracle;
  confidence: number;
}
