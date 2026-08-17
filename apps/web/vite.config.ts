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
        /**
         * `injectManifest`, not `generateSW` — see the header of src/sw.js.
         *
         * The generated worker registered our push handlers from inside an AMD
         * factory that runs a microtask late, via a runtime
         * `importScripts('/push-sw.js')`. Post-evaluation `importScripts` throws
         * in WebKit, so on iOS the `push` listener never existed and a
         * notification arriving while the app was closed had nothing to handle
         * it. Owning the worker means the listeners are registered
         * synchronously, in the first pass, before anything else.
         */
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        registerType: 'prompt',
        // `prompt` over `autoUpdate` on purpose: silently swapping the bundle
        // under someone who is halfway through the profile wizard loses their
        // form state. We show a "new version available" toast instead.
        injectRegister: 'auto',
        includeAssets: [
          'favicon.svg',
          'icons/apple-touch-icon.png',
          'offline.html',
          'push-sw.js',
        ],
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
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          /**
           * `iife`, not the plugin's `es` default.
           *
           * The registration call uses `{ type: 'classic' }`, and a classic
           * worker cannot evaluate an ES module. Rollup's `es` output happens to
           * work while every dependency is inlined — the moment one is not, the
           * worker fails to parse and push dies silently. `iife` cannot drift
           * that way, and a service worker has no reason to be a module.
           */
          rollupFormat: 'iife',
        },
        // Runtime caching lives in src/sw.js now — the `workbox` block only
        // applies to the generated worker this no longer uses.
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
