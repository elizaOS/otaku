import { build } from "bun";
import { rm } from "fs/promises";

// Clean dist directory
await rm("dist", { recursive: true, force: true });

// Build the plugin
const result = await build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  sourcemap: "external",
  minify: false,
  splitting: false,
  external: ["@elizaos/core"],
});

if (!result.success) {
  console.error("Build failed");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("✓ Build completed successfully");
