import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { threeWGSLCompat, threeWGSLCompatOptimizer } from './tools/three-wgsl-compat';

/**
 * Where heavy media (models, textures, audio) is served from; see src/core/assets.ts.
 * An explicit VITE_ASSET_BASE wins (set it empty to serve everything locally).
 * On Render the build points at jsDelivr's mirror of this GitHub repository,
 * pinned to the last commit that touched public/, so asset URLs stay the same
 * - and stay cached in players' browsers - across deploys that change only code.
 */
async function assetBase() {
  if (process.env.VITE_ASSET_BASE !== undefined) return process.env.VITE_ASSET_BASE;
  if (!process.env.RENDER) return '';
  const repo = process.env.RENDER_GIT_REPO_SLUG || 'fdx5/voltaris';
  const commit = process.env.RENDER_GIT_COMMIT ?? '';
  let ref = '';
  try {
    // A full clone can answer locally; Render's shallow clone cannot.
    if (execSync('git rev-parse --is-shallow-repository', { encoding: 'utf8' }).trim() === 'false')
      ref = execSync('git log -1 --format=%H -- public', { encoding: 'utf8' }).trim();
  } catch {
    // No git in the build image.
  }
  if (!ref) {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/commits?path=public&per_page=1&sha=${commit || 'main'}`,
        {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'voltaris-build' },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.ok) ref = ((await response.json()) as { sha: string }[])[0]?.sha ?? '';
    } catch {
      // Offline or rate limited: fall back to the deployed commit below.
    }
  }
  // The deployed commit always carries the same files, only under a new URL.
  ref ||= commit;
  return ref ? `https://cdn.jsdelivr.net/gh/${repo}@${ref}/public` : '';
}
const ASSET_BASE = await assetBase();
process.env.VITE_ASSET_BASE = ASSET_BASE;
const cdn = ASSET_BASE !== '';

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
      // Locally the planet and sky imagery lives in public/textures: without jpg
      // in the glob the backdrop loses its maps as soon as the app runs offline.
      // With the CDN, that media is never precached from the app host - it is
      // cached from the CDN the first time the game asks for it.
      workbox: {
        maximumFileSizeToCacheInBytes: 4000000,
        globPatterns: cdn
          ? ['**/*.{js,css,html,ico,png,svg,webp,webmanifest}']
          : [
              '**/*.{js,css,html,ico,png,svg,jpg,webp,webmanifest}',
              '**/audio/{optionadd,powerup,itemadd,destroy,bosskill,win,nova-blast}.mp3',
            ],
        globIgnores: cdn
          ? ['**/textures/**', '**/textures-ios/**', '**/audio/**', '**/models/**']
          : [],
        navigateFallbackDenylist: [/^\/api\//],
        // Stage tracks are far too large to precache, so they are kept out of
        // the install payload and cached the first time they stream.
        runtimeCaching: [
          {
            // CDN URLs are pinned to a commit, so what is cached never goes stale.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*\.mp3(?:\?|$)/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'voltaris-cdn-audio',
              rangeRequests: true,
              expiration: { maxEntries: 40 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'voltaris-cdn-media',
              expiration: { maxEntries: 120 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/models\/.*\.(?:glb|bin)(?:\?|$)/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'voltaris-imported-fleet-v3',
              expiration: { maxEntries: 4 },
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
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
    // Agent worktrees under .claude/ hold whole builds; watching them crashes
    // the dev server when one of their files is locked mid-write (EBUSY).
    watch: { ignored: ['**/.claude/**'] },
  },
});
