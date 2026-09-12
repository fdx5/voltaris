import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { threeWGSLCompat, threeWGSLCompatOptimizer } from './tools/three-wgsl-compat';
export default defineConfig({
  plugins: [
    threeWGSLCompat(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'VOLTARIS',
        short_name: 'VOLTARIS',
        description: 'An original 3D orbital arcade shooter',
        theme_color: '#070c12',
        background_color: '#070c12',
        display: 'fullscreen',
        orientation: 'landscape',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      // The planet and sky imagery lives in public/textures: without jpg in the
      // glob the backdrop loses its maps as soon as the app runs offline.
      workbox: {
        maximumFileSizeToCacheInBytes: 4000000,
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,jpg,webp,webmanifest}',
          '**/audio/{optionadd,powerup,itemadd,destroy,bosskill,win}.mp3',
        ],
        navigateFallbackDenylist: [/^\/api\//],
        // Stage tracks are far too large to precache, so they are kept out of
        // the install payload and cached the first time they stream.
        runtimeCaching: [
          {
            urlPattern: /\/models\/.*\.glb(?:\?|$)/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'voltaris-blender-fleet',
              expiration: { maxEntries: 2 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/audio\/.*\.mp3$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'voltaris-music',
              rangeRequests: true,
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist/client',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks: { three: ['three/webgpu', 'three/tsl'] } } },
  },
  optimizeDeps: { esbuildOptions: { plugins: [threeWGSLCompatOptimizer()] } },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
});
