import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Concorde: a SPA é servida pelo Worker do Cloudflare (pasta dist = assets do Worker).
// Em desenvolvimento, /api vai para o `wrangler dev` (porta 8787).
export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
});
