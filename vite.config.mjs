import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.IS_PREACT': 'false' },
  build: { chunkSizeWarningLimit: 2000, outDir: process.env.VITE_STORAGE_MODE==='browser'?'dist-web':'dist', sourcemap:false },
});
