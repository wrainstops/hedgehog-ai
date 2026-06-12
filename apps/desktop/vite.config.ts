import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@hedgehog/protocol': path.resolve(__dirname, '../../packages/protocol/src/index.ts'),
      '@hedgehog/storage': path.resolve(__dirname, '../../packages/storage/src/index.ts'),
      '@hedgehog/i18n': path.resolve(__dirname, '../../packages/i18n/src/index.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
