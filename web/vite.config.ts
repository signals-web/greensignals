/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@sosisu/platform': path.resolve(__dirname, '../../platform/src'),
    },
  },
  test: {
    environment: 'jsdom',
  },
});
