// Bundles the server and the web app's retrieval into one dependency-free file.
import { build } from "esbuild";
await build({
  entryPoints: [new URL("./src/server.ts", import.meta.url).pathname],
  outfile: new URL("./dist/intellirag-mcp.mjs", import.meta.url).pathname,
  // Paths in the bundle's comments are relative to the repository root, so the
  // output is the same wherever the build is started from (CI diffs it).
  absWorkingDir: new URL("..", import.meta.url).pathname,
  bundle: true, platform: "node", format: "esm", target: "node20", legalComments: "none",
  banner: { js: "#!/usr/bin/env node\n// Built from mcp/src by mcp/build.mjs. Do not edit." },
  logLevel: "warning",
});
