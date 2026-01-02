import type { MarketSummary } from '../types/marketTypes';

export const fetchMarkets = async (): Promise<MarketSummary[]> => {
  return [
    {
      id: 'kai-001',
      title: 'Kairos lunar relay completes before dusk?',
      category: 'Kairos Ops',
      description: 'Guild watchers expect a relay alignment before the dusk hour.',
      status: 'open',
      yesPrice: 0.62,
      noPrice: 0.38,
      volume: 142_320,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString(),
      oracle: {
        id: 'oracle-aurora',
        name: 'Aurora Sigil',
        icon: '✨',
        trustScore: 0.91
      },
      confidence: 0.82
    },
    {
      id: 'kai-002',
      title: 'Will Verahai vault streak reach 9 cycles?',
      category: 'Vault',
      description: 'Current streak sits at 7; momentum pulse trending.',
      status: 'open',
      yesPrice: 0.44,
      noPrice: 0.56,
      volume: 88_420,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString(),
      oracle: {
        id: 'oracle-vera',
        name: 'Verahai Oracle',
        icon: '🜂',
        trustScore: 0.87
      },
      confidence: 0.76
    },
    {
      id: 'kai-003',
      title: 'SigilMarkets glow mode unlocked in 24h?',
      category: 'Kai UX',
      description: 'Based on prophecy feed confidence pulses.',
      status: 'locked',
      yesPrice: 0.73,
      noPrice: 0.27,
      volume: 52_110,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 3).toISOString(),
      oracle: {
        id: 'oracle-kai',
        name: 'Kai Core',
        icon: '◈',
        trustScore: 0.93
      },
      confidence: 0.9
    }
  ];
};
