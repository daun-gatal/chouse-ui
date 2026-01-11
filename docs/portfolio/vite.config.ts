import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // For GitHub Pages, always use /chouse-ui/ base path in production
  // This ensures all assets are correctly prefixed
  const base = process.env.VITE_BASE_PATH || (mode === 'production' ? '/chouse-ui/' : '/');
  
  return {
    plugins: [react()],
    base,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
    },
  };
});
