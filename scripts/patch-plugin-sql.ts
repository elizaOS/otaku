#!/usr/bin/env bun
/**
 * Patches @elizaos/plugin-sql to fix SET LOCAL parameterization bug.
 *
 * Bug: sql`SET LOCAL app.entity_id = ${entityId}` becomes "SET LOCAL app.entity_id = $1"
 *      which PostgreSQL rejects (SET LOCAL doesn't support parameterized queries)
 *
 * Fix: Use sql.raw() for inline interpolation instead
 *
 * Run automatically via postinstall or manually: bun run scripts/patch-plugin-sql.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const PLUGIN_SQL_PATH = join(import.meta.dir, '../node_modules/@elizaos/plugin-sql/dist/node/index.node.js');

const PATCHES = [
  {
    name: 'SET LOCAL app.entity_id parameterization fix',
    search: 'await tx.execute(sql`SET LOCAL app.entity_id = ${entityId}`);',
    // Note: entityId is validated as UUID type upstream in ElizaOS (src/types.ts)
    // The withEntityContext function signature enforces UUID | null type
    // SQL injection risk is mitigated by this type validation before reaching this code
    replace: "await tx.execute(sql.raw(`SET LOCAL app.entity_id = '${entityId}'`));",
  },
];

function applyPatches() {
  if (!existsSync(PLUGIN_SQL_PATH)) {
    console.log('⏭️  @elizaos/plugin-sql not installed, skipping patches');
    return;
  }

  let content = readFileSync(PLUGIN_SQL_PATH, 'utf-8');
  let patchesApplied = 0;

  for (const patch of PATCHES) {
    if (content.includes(patch.replace)) {
      console.log(`✅ ${patch.name} (already applied)`);
      continue;
    }

    if (!content.includes(patch.search)) {
      console.log(`⚠️  ${patch.name} (pattern not found - may be fixed upstream)`);
      continue;
    }

    content = content.replace(patch.search, patch.replace);
    patchesApplied++;
    console.log(`🔧 ${patch.name} (applied)`);
  }

  if (patchesApplied > 0) {
    writeFileSync(PLUGIN_SQL_PATH, content);
    console.log(`\n✅ Applied ${patchesApplied} patch(es) to @elizaos/plugin-sql`);
  }
}

applyPatches();

