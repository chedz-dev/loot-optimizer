import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  define: {
    // Renueva la versión de los JSON en cada ejecución e intento del deploy.
    __DATA_VERSION__: JSON.stringify(process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SHA || 'ci'}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`
      : process.env.GITHUB_SHA || Date.now().toString()),
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
});
