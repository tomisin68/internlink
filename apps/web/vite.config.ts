import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        // `prompt` over `autoUpdate` on purpose: silently swapping the bundle
        // under someone who is halfway through the profile wizard loses their
        // form state. We show a "new version available" toast instead.
        injectRegister: 'auto',
        includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'offline.html'],
        manifest: {
          id: '/',
          name: 'InternLink — Internships & Entry-Level Roles',
          short_name: 'InternLink',
          description:
            'Find internships and entry-level roles, or hire the interns who will grow your team.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait-primary',
          background_color: '#f8f8fc',
          theme_color: '#6c4cf1',
          categories: ['business', 'education', 'social'],
          lang: 'en-NG',
          dir: 'ltr',
          icons: [
            { src: '/icons/icon-64.png', sizes: '64x64', type: 'image/png' },
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            // A maskable icon needs its art inside the safe zone or Android
            // crops the logo. This one is generated with the required padding.
            {
              src: '/icons/maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            { name: 'Find roles', short_name: 'Roles', url: '/roles' },
            { name: 'My applications', short_name: 'Applications', url: '/applications' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          cleanupOutdatedCaches: true,
          navigateFallback: '/index.html',
          // Never let the SW serve a cached shell for API calls — a stale
          // session payload is worse than an offline error.
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // Google Fonts stylesheets change rarely; the files never change.
              urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'google-fonts-stylesheets' },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-files',
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Cloudinary media — immutable per URL, safe to cache hard.
              urlPattern: /^https:\/\/res\.cloudinary\.com\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'cloudinary-media',
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Listing reads are safe to show stale for a moment while the
              // network catches up. Auth and writes are NOT cached at all.
              urlPattern: ({ url, request }) =>
                request.method === 'GET' && /\/v1\/listings/.test(url.pathname),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-listings',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 10 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
        devOptions: {
          // Keep the SW off in `vite dev` — an aggressively cached shell during
          // development is a reliable way to waste an afternoon.
          enabled: false,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // Keeps the browser same-origin in dev, so cookies and CORS behave the
        // way they will in production behind one domain.
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:4000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          /**
           * Split the heavy, rarely-changing vendors so a copy tweak does not
           * invalidate half a megabyte of Firebase for every returning user.
           *
           * Matched by module path rather than by a static list of entry
           * specifiers: `firebase/firestore` and `firebase/analytics` were
           * added later and silently fell into the main bundle, taking the
           * entry chunk from 110kB to 193kB gzipped before anyone noticed. A
           * path match cannot drift that way.
           */
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'vendor-firebase';
            if (id.includes('/react-router') || id.includes('/react-dom/') || id.includes('/react/'))
              return 'vendor-react';
            if (id.includes('/framer-motion/') || id.includes('/motion-')) return 'vendor-motion';
            if (id.includes('/@tanstack/')) return 'vendor-query';
            if (id.includes('/zod/') || id.includes('/react-hook-form/')) return 'vendor-forms';
            return undefined;
          },
        },
      },
    },
  };
});
