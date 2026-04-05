/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pinned ports so cross-app handoff URLs stay stable in dev.
  // Signal 5173, Surface 5174, Solid 5175.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      '@sosisu/platform': path.resolve(__dirname, '../../platform/src'),
    },
  },
  test: {
    environment: 'jsdom',
  },
});
