#!/usr/bin/env bun
/**
 * Build script for backend
 */

import { existsSync } from 'node:fs';
import { rm, cp, mkdir } from 'node:fs/promises';
import { $ } from 'bun';
import { resolve, dirname } from 'node:path';
import { watchFiles } from './src/build-utils';

async function cleanBuild(outdir = 'dist') {
  if (existsSync(outdir)) {
    await rm(outdir, { recursive: true, force: true });
    console.log(` Cleaned ${outdir} directory`);
  }
}

async function copySharedModules() {
  console.log(' Copying shared modules...');
  
  // Copy and compile managers directory to dist/managers
  if (existsSync('./src/managers')) {
    await cp('./src/managers', './dist/managers', { recursive: true });
    console.log(' Copied managers/');
  }
  
  // Copy and compile constants directory to dist/constants
  if (existsSync('./src/constants')) {
    await cp('./src/constants', './dist/constants', { recursive: true });
    console.log(' Copied constants/');
  }
  
  // Compile the TypeScript files in place
  try {
    console.log(' Compiling shared modules...');
    
    // Build managers
    const managersResult = await Bun.build({
      entrypoints: ['./dist/managers/cdp-transaction-manager.ts'],
      outdir: './dist/managers',
      target: 'node',
      format: 'esm',
      external: ['@elizaos/core', '@coinbase/cdp-sdk', 'viem', 'viem/accounts'],
      naming: { entry: '[name].js' },
    });
    
    // Build constants
    const constantsResult = await Bun.build({
      entrypoints: ['./dist/constants/chains.ts'],
      outdir: './dist/constants',
      target: 'node',
      format: 'esm',
      external: ['viem/chains'],
      naming: { entry: '[name].js' },
    });
    
    if (managersResult.success && constantsResult.success) {
      console.log(' Shared modules compiled successfully');
    } else {
      console.warn(' Warning: Some shared modules failed to compile');
    }
  } catch (error) {
    console.warn(' Warning: Failed to compile shared modules:', error);
  }
}

async function build(options: { clean?: boolean } = {}) {
  const { clean = true } = options;
  const start = performance.now();
  console.log(' Building backend...');

  try {
    // Clean previous build
    if (clean) {
      await cleanBuild('dist');
    }

    // Build backend
    const [buildResult, tscResult] = await Promise.all([
      // Task 1: Build with Bun
      (async () => {
        console.log(' Bundling backend with Bun...');
        const result = await Bun.build({
          entrypoints: ['./src/index.ts'],
          outdir: './dist',
          target: 'node',
          format: 'esm',
          sourcemap: true,
          minify: false,
          external: [
            'dotenv',
            'fs',
            'path',
            'https',
            'node:*',
            '@elizaos/core',
            '@elizaos/plugin-bootstrap',
            '@elizaos/plugin-sql',
            '@elizaos/server',
            'zod',
          ],
          naming: {
            entry: '[dir]/[name].[ext]',
          },
          // Add path resolution plugin to handle @/ aliases
          plugins: [
            {
              name: 'path-alias-resolver',
              setup(build) {
                build.onResolve({ filter: /^@\// }, (args) => {
                  // Make these imports external and rewrite them to relative paths from dist/
                  const relativePath = args.path.slice(2); // Remove "@/"
                  // Return as external with the rewritten path
                  return { path: `./${relativePath}.js`, external: true };
                });
              },
            },
          ],
        });

        if (!result.success) {
          console.error(' Build failed:', result.logs);
          return { success: false };
        }

        const totalSize = result.outputs.reduce((sum, output) => sum + output.size, 0);
        const sizeMB = (totalSize / 1024 / 1024).toFixed(2);
        console.log(` Built ${result.outputs.length} file(s) - ${sizeMB}MB`);

        return result;
      })(),

      // Task 2: Generate TypeScript declarations
      (async () => {
        // Skip type generation in watch mode optimization (optional, but keep for now)
        console.log(' Generating TypeScript declarations...');
        try {
          await $`tsc --emitDeclarationOnly`.quiet();
          console.log(' TypeScript declarations generated');
          return { success: true };
        } catch (error) {
          console.warn(' Failed to generate TypeScript declarations');
          return { success: false };
        }
      })(),
    ]);

    if (!buildResult.success) {
      return false;
    }

    // Copy shared modules after build
    await copySharedModules();

    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    console.log(` Backend build complete! (${elapsed}s)`);
    return true;
  } catch (error) {
    console.error('Build error:', error);
    return false;
  }
}

const isWatchMode = process.argv.includes('--watch');

async function main() {
  if (isWatchMode) {
    console.log(' Starting watch mode...\n');

    // Initial build
    await build({ clean: true });

    const srcDir = resolve(process.cwd(), 'src');

    // Start watcher
    watchFiles(srcDir, async () => {
      // Rebuild without full clean for speed
      await build({ clean: false });
    });
  } else {
    const success = await build({ clean: true });
    if (!success) {
      process.exit(1);
    }
  }
}

// Execute
main().catch((error) => {
  console.error('Build script error:', error);
  process.exit(1);
});

