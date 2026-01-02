import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { SigilMarketsShell } from './SigilMarkets/SigilMarketsShell';
import './SigilMarkets/styles/sigilMarkets.css';
import './SigilMarkets/styles/breathe.css';
import './SigilMarkets/styles/motion.css';

const queryClient = new QueryClient();

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SigilMarketsShell />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
