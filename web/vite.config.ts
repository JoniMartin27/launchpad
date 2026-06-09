import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server runs on 127.0.0.1:5180 and proxies the REST API (/api) and the
// WebSocket (/ws) to the Fastify backend on 127.0.0.1:7777 (see SPEC §6.4).
// We never bind 0.0.0.0 — loopback only.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7777', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:7777', ws: true }
    }
  }
});
