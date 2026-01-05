import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { SigilMarketsShell } from './SigilMarkets/SigilMarketsShell';
import './SigilMarkets/styles/sigilMarkets.css';
import './SigilMarkets/styles/breathe.css';
import './SigilMarkets/styles/motion.css';

const queryClient = new QueryClient();

registerSW({ immediate: true });

const SigilPage = React.lazy(() => import('./pages/SigilPage/SigilPage'));
const KeyStream = React.lazy(() => import('./components/SigilExplorer'));
const VerifyPage = React.lazy(() => import('./pages/VerifyPage'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="s" element={<SigilPage />} />
            <Route path="s/:hash" element={<SigilPage />} />
            <Route path="*" element={<SigilMarketsShell />} />
            <Route path="/keystream" element={<KeyStream />} />
            <Route path="/verify" element={<VerifyPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
