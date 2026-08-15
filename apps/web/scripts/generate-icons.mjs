/**
 * Rasterises the InternLink mark into every PNG size the manifest references.
 *
 * Run with `npm run icons -w @internlink/web` after changing the mark.
 * Checked-in PNGs are the build input; this script regenerates them.
 *
 * The maskable variant is drawn separately rather than just padded, because
 * Android crops maskable icons to a circle of ~80% width. Art that sits right
 * to the edge of the square loses its corners.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/icons');

const GRADIENT = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8f6dfa" />
      <stop offset="55%" stop-color="#6c4cf1" />
      <stop offset="100%" stop-color="#5a38d8" />
    </linearGradient>
  </defs>`;

const MARK = `
  <path d="M20 42V26a6 6 0 0 1 12 0v12a6 6 0 0 0 12 0V22"
        fill="none" stroke="#ffffff" stroke-width="5.5"
        stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="44" cy="22" r="5" fill="#ff6b5b" stroke="#ffffff" stroke-width="3" />`;

/** Standard icon: rounded square, art near the edges. */
const standardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${GRADIENT}
  <rect width="64" height="64" rx="16" fill="url(#g)" />
  ${MARK}
</svg>`;

/**
 * Maskable icon: full-bleed background, art scaled to ~62% and centred so it
 * survives the circular crop with room to spare.
 */
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  ${GRADIENT}
  <rect width="64" height="64" fill="url(#g)" />
  <g transform="translate(32 32) scale(0.62) translate(-32 -32)">
    ${MARK}
  </g>
</svg>`;

const targets = [
  { name: 'icon-64.png', size: 64, svg: standardSvg },
  { name: 'icon-192.png', size: 192, svg: standardSvg },
  { name: 'icon-512.png', size: 512, svg: standardSvg },
  { name: 'maskable-512.png', size: 512, svg: maskableSvg },
  { name: 'apple-touch-icon.png', size: 180, svg: standardSvg },
];

await mkdir(outDir, { recursive: true });

for (const target of targets) {
  const png = await sharp(Buffer.from(target.svg))
    .resize(target.size, target.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(outDir, target.name), png);
  console.log(`  ✓ ${target.name} (${target.size}×${target.size}, ${(png.length / 1024).toFixed(1)}kB)`);
}

// A minimal offline shell. The service worker falls back to this only when the
// navigation request fails AND the app shell is not yet cached — i.e. the very
// first load while offline.
const offlineHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Offline — InternLink</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center;
         font-family: Inter, system-ui, sans-serif; background:#f8f8fc; color:#12132a;
         padding: 2rem; text-align:center; }
  @media (prefers-color-scheme: dark) { body { background:#0b0c18; color:#e8e8f5; } }
  .mark { width:56px; height:56px; border-radius:16px; background:linear-gradient(135deg,#8f6dfa,#5a38d8);
          margin:0 auto 1.25rem; }
  h1 { font-size:1.375rem; margin:0 0 .5rem; }
  p { margin:0; color:#565670; max-width:32ch; }
  @media (prefers-color-scheme: dark) { p { color:#a8a8c4; } }
</style></head>
<body><div><div class="mark"></div><h1>You're offline</h1>
<p>Reconnect and InternLink will pick up right where you left off.</p></div></body></html>`;

await writeFile(resolve(here, '../public/offline.html'), offlineHtml, 'utf8');
console.log('  ✓ offline.html');
