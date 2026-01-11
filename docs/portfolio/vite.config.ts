import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // For GitHub Pages with custom domain, use root base path (/)
  // For GitHub Pages without custom domain (subpath), use /chouse-ui/
  // Can be overridden with VITE_BASE_PATH environment variable
  const base = process.env.VITE_BASE_PATH || (mode === 'production' ? '/' : '/');
  
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
