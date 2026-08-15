import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The suites that exist today are pure logic — ranking, matching, scam
    // detection. Nothing here touches Firestore, so there is no setup file and
    // no emulator dependency. Keep it that way: anything needing I/O belongs in
    // a separate integration project, not bolted onto this one.
    coverage: {
      provider: 'v8',
      include: ['src/modules/feed/**', 'src/modules/moderation/**'],
      reporter: ['text-summary'],
    },
  },
  resolve: {
    // The source imports its own modules with a `.js` extension for NodeNext
    // compatibility, but the files on disk are `.ts`. Vitest resolves through
    // Vite, which needs to be told.
    extensions: ['.ts', '.js', '.json'],
  },
});
