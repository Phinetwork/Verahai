import type { OracleSignal } from '../types/oracleTypes';

export const fetchOracleSignals = async (): Promise<OracleSignal[]> => {
  return [
    {
      id: 'sig-1',
      title: 'Aurora pulse intensifies',
      message: 'Night lattice shows elevated yes pressure for Kai-001.',
      confidence: 0.78,
      createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      source: 'Aurora Sigil'
    },
    {
      id: 'sig-2',
      title: 'Vault resonance stable',
      message: 'Verahai core vault maintains steady growth rhythm.',
      confidence: 0.84,
      createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
      source: 'Verahai Oracle'
    }
  ];
};
