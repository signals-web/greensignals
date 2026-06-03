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
    // Node environment: none of Signal's current tests touch the DOM.
    // The jsdom environment combined with the default forks pool
    // hangs worker spin-up on this Dropbox-mounted workspace path
    // (URL-encoded spaces in the cwd confuse vitest's worker
    // resolver). If a UI-mounting test arrives, switch this back to
    // 'jsdom' for that file via `// @vitest-environment jsdom`.
    environment: 'node',
    pool: 'forks',
    // Vitest 4 dropped `poolOptions` from `InlineConfig`'s type but
    // still accepts it at runtime; using it (or its v4 top-level
    // siblings `forks` / `threads`) tightens the worker spin-up
    // path that times out on this workspace's URL-encoded path.
    forks: { singleFork: true, isolate: false },
  } as any,
});
