#!/usr/bin/env bun
/**
 * Build script for @elizaos/plugin-gamification
 */

import { build } from 'bun';

const result = await build({
  entrypoints: ['src/index.ts'],
  outdir: 'dist',
  target: 'node',
  format: 'esm',
  external: [
    '@elizaos/core',
    '@elizaos/plugin-sql',
    'drizzle-orm',
    'uuid',
  ],
  sourcemap: true,
  minify: false,
});

if (result.success) {
  console.log('✓ Build successful');
} else {
  console.error('✗ Build failed');
  process.exit(1);
}

