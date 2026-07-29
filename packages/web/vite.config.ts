import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env.API_PORT ?? '8787';
const webPort = Number(process.env.WEB_PORT ?? '5173');

export default defineConfig({
  plugins: [react()],
  server: {
    // localhost は環境によって IPv6 へ解決されるため、待ち受けアドレスを明示する。
    // 同一ネットワークの実機から確認したい場合は WEB_HOST=0.0.0.0 を指定する。
    host: process.env.WEB_HOST ?? '127.0.0.1',
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
