import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SigilMarketsRoutes } from './SigilMarketsRoutes';
import { SigilMarketsDock } from './SigilMarketsDock';
import { TopBar } from './ui/chrome/TopBar';
import { BreathGlow } from './ui/motion/BreathGlow';
import { useScrollRestoration } from './hooks/useScrollRestoration';
import { useMarketStore } from './state/marketStore';
import { useVaultStore } from './state/vaultStore';
import { usePositionStore } from './state/positionStore';
import { useFeedStore } from './state/feedStore';
import { useUiStore } from './state/uiStore';
import { fetchMarkets } from './api/marketApi';
import { fetchVault } from './api/vaultApi';
import { fetchPositions } from './api/positionApi';
import { fetchOracleSignals } from './api/oracleApi';

export const SigilMarketsShell = () => {
  const setMarkets = useMarketStore((state) => state.setMarkets);
  const setVault = useVaultStore((state) => state.setVault);
  const setPositions = usePositionStore((state) => state.setPositions);
  const setSignals = useFeedStore((state) => state.setSignals);
  const { isImmersive, toggleImmersive } = useUiStore();
  const [network, setNetwork] = useState('online');
  const [battery, setBattery] = useState<number | null>(null);

  useScrollRestoration();

  useQuery({
    queryKey: ['markets'],
    queryFn: fetchMarkets,
    onSuccess: setMarkets
  });

  useQuery({
    queryKey: ['vault'],
    queryFn: fetchVault,
    onSuccess: setVault
  });

  useQuery({
    queryKey: ['positions'],
    queryFn: fetchPositions,
    onSuccess: setPositions
  });

  useQuery({
    queryKey: ['signals'],
    queryFn: fetchOracleSignals,
    onSuccess: setSignals
  });

  useEffect(() => {
    const updateNetwork = () => setNetwork(navigator.onLine ? 'online' : 'offline');
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    updateNetwork();

    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);

  useEffect(() => {
    if (!('getBattery' in navigator)) {
      return;
    }
    const setupBattery = async () => {
      const batteryManager = await (navigator as Navigator & { getBattery: () => Promise<BatteryManager> }).getBattery();
      setBattery(batteryManager.level);
      batteryManager.addEventListener('levelchange', () => setBattery(batteryManager.level));
    };
    void setupBattery();
  }, []);

  const aura = useMemo(() => (isImmersive ? 'sm-shell sm-shell--immersive' : 'sm-shell'), [isImmersive]);

  return (
    <div className={aura}>
      <BreathGlow />
      <TopBar onModeToggle={toggleImmersive} isImmersive={isImmersive} />
      <div className="sm-shell__status">
        <span>Network: {network}</span>
        <span>Battery: {battery ? `${Math.round(battery * 100)}%` : '—'}</span>
        <span>Kai aware</span>
      </div>
      <main className="sm-shell__main">
        <SigilMarketsRoutes />
      </main>
      <SigilMarketsDock />
    </div>
  );
};
