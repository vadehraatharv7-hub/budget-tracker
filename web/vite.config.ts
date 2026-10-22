import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    // BUILD_OUT lets the deploy script build beside the live site and swap directories afterwards.
    outDir: process.env.BUILD_OUT ?? '../dist',
    emptyOutDir: true,
    sourcemap: false,
    // The CSP forbids data: fonts, so never inline assets into CSS/JS.
    assetsInlineLimit: 0,
    target: 'es2022',
  },
  server: {
    port: 5173,
    // `npm run dev` (API on :3000) + `npm run dev:web` (this server) gives hot reload against the real API.
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
