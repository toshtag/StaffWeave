import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env.API_PORT ?? '8787';
const webPort = Number(process.env.WEB_PORT ?? '5173');

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    // 開発中は同一オリジンで API を扱えるようにする。
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
