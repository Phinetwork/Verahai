import { Routes, Route } from 'react-router-dom';
import { MarketGrid } from './views/MarketGrid/MarketGrid';
import { MarketRoom } from './views/MarketRoom/MarketRoom';
import { VaultPanel } from './views/Vault/VaultPanel';
import { PositionsHome } from './views/Positions/PositionsHome';
import { ProphecyFeed } from './views/Prophecy/ProphecyFeed';
import { ResolutionCenter } from './views/Resolution/ResolutionCenter';

export const SigilMarketsRoutes = () => {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <>
            <MarketGrid />
            <MarketRoom />
          </>
        }
      />
      <Route path="/vault" element={<VaultPanel />} />
      <Route path="/positions" element={<PositionsHome />} />
      <Route path="/prophecy" element={<ProphecyFeed />} />
      <Route path="/resolution" element={<ResolutionCenter />} />
    </Routes>
  );
};
