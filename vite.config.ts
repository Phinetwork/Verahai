import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import sigilProofHandler from './api/proof/sigil.js';

const USE_EXTERNAL_PROOF_API = process.env.SIGIL_PROOF_API === 'external';
const PROOF_API_TARGET = process.env.SIGIL_PROOF_API_URL ?? 'http://localhost:8787';

function sigilProofApi() {
  const handler = async (req: unknown, res: unknown, next: () => void) => {
    const reqAny = req as { method?: string };
    const resAny = res as {
      statusCode?: number;
      setHeader: (name: string, value: string) => void;
      end: (chunk?: string) => void;
      writableEnded?: boolean;
    };
    if ((reqAny.method ?? 'GET').toUpperCase() !== 'POST') {
      resAny.statusCode = 405;
      resAny.setHeader('Content-Type', 'application/json');
      resAny.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      await sigilProofHandler(reqAny, resAny);
      if (!resAny.writableEnded && typeof next === 'function') next();
    } catch (error) {
      if (!resAny.writableEnded) {
        resAny.statusCode = 500;
        resAny.setHeader('Content-Type', 'application/json');
        resAny.end(JSON.stringify({ error: 'Proof handler failed to load' }));
      }
      if (typeof next === 'function') next(error as Error);
    }
  };

  return {
    name: 'sigil-proof-api',
    configureServer(server: { middlewares: { use: (path: string, cb: (req: unknown, res: unknown) => void) => void } }) {
      server.middlewares.use('/api/proof/sigil', handler);
    },
    configurePreviewServer(server: { middlewares: { use: (path: string, cb: (req: unknown, res: unknown) => void) => void } }) {
      server.middlewares.use('/api/proof/sigil', handler);
    }
  };
}

export default defineConfig(({ command }) => ({
  resolve: {
    alias: {
      html2canvas: '/src/shims/html2canvas.ts'
    }
  },
  server: USE_EXTERNAL_PROOF_API
    ? {
        proxy: {
          '/api/proof/sigil': PROOF_API_TARGET
        }
      }
    : undefined,
  preview: USE_EXTERNAL_PROOF_API
    ? {
        proxy: {
          '/api/proof/sigil': PROOF_API_TARGET
        }
      }
    : undefined,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['verahai-icon.svg'],
      manifest: {
        name: 'Verahai · SigilMarkets',
        short_name: 'Verahai',
        description: 'SigilMarkets for Kairos glyph prophecy markets.',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/verahai-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable any'
          }
        ]
      }
    }),
    ...(USE_EXTERNAL_PROOF_API || !(command === 'serve' || command === 'preview') ? [] : [sigilProofApi()])
  ]
}));
