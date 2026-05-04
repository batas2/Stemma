import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: path.resolve(__dirname, '../Verso.Web/wwwroot'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5050', changeOrigin: true },
      '/hubs': { target: 'http://localhost:5050', changeOrigin: true, ws: true },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['tests/visual/**', 'node_modules/**'],
  },
});
