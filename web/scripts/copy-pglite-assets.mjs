#!/usr/bin/env node
/**
 * Nitro's Vercel bundle inlines @electric-sql/pglite JS but not the WASM / FS
 * image it loads via locateFile(). Production then dies with:
 *   ENOENT: open '/var/task/_libs/pglite.data'
 * Copy those assets next to the bundled module after `vite build`.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, "node_modules/@electric-sql/pglite/dist");
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];
const destDirs = [
  join(root, ".vercel/output/functions/__server.func/_libs"),
  join(root, ".vercel/output/functions/__server.func"),
  join(root, ".output/server/_libs"),
  join(root, ".output/server"),
];

let copied = 0;
for (const destDir of destDirs) {
  const parent = dirname(destDir);
  if (!existsSync(parent) && !existsSync(destDir)) continue;
  mkdirSync(destDir, { recursive: true });
  for (const name of files) {
    const from = join(srcDir, name);
    if (!existsSync(from)) {
      console.warn(`[pglite-assets] missing ${from}`);
      continue;
    }
    copyFileSync(from, join(destDir, name));
    copied += 1;
  }
}

if (!copied) {
  console.warn("[pglite-assets] no Nitro output dirs yet — skipped");
} else {
  console.log(`[pglite-assets] copied ${copied} file(s)`);
}
