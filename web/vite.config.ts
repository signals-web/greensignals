/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pinned ports so cross-app handoff URLs stay stable in dev.
  // Signal 5173, Surface 5174, Solid 5175.
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/maptiler': {
        target: 'https://api.maptiler.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/maptiler/, ''),
      },
    },
  },
  preview: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      '@sosisu/platform': path.resolve(__dirname, '../../platform/src'),
    },
  },
  // Test config — see comments below. The pool options are typed
  // looser than runtime accepts in Vitest 4, so we widen the test
  // block and rely on Vitest's runtime validation rather than TS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test: {
    // Node environment by default; per-file jsdom opt-in stays via
    // `// @vitest-environment jsdom` (placeSignMarker.test.ts).
    environment: 'node',
    // THREADS pool, single worker, no isolation. The forks pool can't
    // spawn a SECOND worker on this Dropbox-mounted workspace path
    // (URL-encoded spaces in the cwd confuse the worker resolver), so
    // any `@vitest-environment jsdom` file hit a 60s spawn timeout and
    // was silently DROPPED from the run (25 files reported, 26 exist).
    // worker_threads don't re-spawn a process, so the jsdom file runs;
    // singleThread + isolate:false avoids the per-file worker churn
    // that costs ~50s of environment setup on this filesystem.
    pool: 'threads',
    // Vitest 4 dropped `poolOptions` from `InlineConfig`'s type but
    // still accepts the v4 top-level pool-named siblings at runtime.
    threads: { singleThread: true, isolate: false },
  } as any,
});
