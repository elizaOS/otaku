import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    root: './src/frontend',
    base: './',
    envDir: path.resolve(__dirname, './'),  // Use absolute path to project root
    build: {
      outDir: '../../dist/frontend',
      emptyOutDir: true,
      sourcemap: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src/frontend'),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
    }
  };
});

