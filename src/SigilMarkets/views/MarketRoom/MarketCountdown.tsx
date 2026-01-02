import { useMemo } from 'react';

interface MarketCountdownProps {
  expiresAt: string;
}

export const MarketCountdown = ({ expiresAt }: MarketCountdownProps) => {
  const label = useMemo(() => {
    const diff = new Date(expiresAt).getTime() - Date.now();
    const hours = Math.max(0, Math.floor(diff / 3600000));
    const minutes = Math.max(0, Math.floor((diff % 3600000) / 60000));
    return `${hours}h ${minutes}m remaining`;
  }, [expiresAt]);

  return <div className="sm-room__countdown">{label}</div>;
};
