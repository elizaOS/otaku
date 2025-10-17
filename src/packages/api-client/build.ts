#!/usr/bin/env bun
/**
 * Build script for @elizaos/api-client using standardized build utilities
 */

import { createBuildRunner } from '../../build-utils';

// Create and run the standardized build runner
const run = createBuildRunner({
  packageName: '@elizaos/api-client',
  buildOptions: {
    entrypoints: ['src/index.ts'],
    outdir: 'dist',
    target: 'node',
    format: 'esm',
    external: ['@elizaos/core', 'fs', 'path'],
    sourcemap: true,
    minify: false,
    generateDts: true,
  },
  onBuildComplete: async (success) => {
    if (success) {
      // Re-export all types and client from the proper dist structure
      const rootDtsContent = `// Main client
export { ElizaClient } from './client';

// Base types
export * from './types/base';

// Domain types
export * from './types/agents';
export * from './types/messaging';
export * from './types/memory';
export * from './types/audio';
export * from './types/media';
export * from './types/server';
export * from './types/system';
export * from './types/sessions';
export * from './types/runs';

// Services (for advanced usage)
export { AgentsService } from './services/agents';
export { MessagingService } from './services/messaging';
export { MemoryService } from './services/memory';
export { AudioService } from './services/audio';
export { MediaService } from './services/media';
export { ServerService } from './services/server';
export { SystemService } from './services/system';
export { SessionsService } from './services/sessions';
export { RunsService } from './services/runs';

// Base client and error
export { BaseApiClient, ApiError } from './lib/base-client';
`;
      await Bun.write('./dist/index.d.ts', rootDtsContent);
      console.log('✓ Created root index.d.ts');
    }
  },
});

// Execute the build
run().catch((error) => {
  console.error('Build script error:', error);
  process.exit(1);
});
