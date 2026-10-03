import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// Dev server proxies the status API of a running AEGIS server
// (e.g. examples/express-integration): AEGIS_API=http://localhost:3000 npm run dev
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/aegis': process.env.AEGIS_API ?? 'http://localhost:3000' },
    fs: { allow: [repoRoot] },
  },
  resolve: {
    alias: { '@results': fileURLToPath(new URL('../../docs/thesis/results', import.meta.url)) },
  },
});
