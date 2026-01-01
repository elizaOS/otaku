import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load all env vars for filtering (only VITE_* will be exposed to frontend)
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    root: './src/frontend',
    base: './',
    envDir: path.resolve(__dirname, './'),
    build: {
      outDir: '../../dist/frontend',
      emptyOutDir: true,
      sourcemap: mode === 'development',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src/frontend'),
        // Frontend never executes x402-fetch, but Vite still tries to resolve it
        // because backend files import it. Point to a browser-safe shim so the
        // resolver stops touching the broken package metadata.
        'x402-fetch': path.resolve(
          __dirname,
          './src/frontend/shims/x402-fetch.ts'
        ),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
    },
    // Only expose VITE_* prefixed env vars to import.meta.env (safe for frontend)
    define: Object.keys(env)
      .filter(key => key.startsWith('VITE_'))
      .reduce((acc, key) => {
        acc[`import.meta.env.${key}`] = JSON.stringify(env[key]);
        return acc;
      }, {} as Record<string, string>),
  };
});

