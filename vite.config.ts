import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
    })
  ]
});
