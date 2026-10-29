import { build } from "esbuild";
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  memo = path.resolve("../../../memorable/src");
await build({
  entryPoints: ["engine.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/engine.mjs",
  plugins: [
    {
      name: "memo-alias",
      setup(b) {
        b.onResolve({ filter: /^@\// }, (args) => {
          const p = path.join(memo, args.path.slice(2));
          return {
            path: existsSync(p + ".ts") ? p + ".ts" : path.join(p, "index.ts"),
          };
        });
        b.onResolve({ filter: /^zod$/ }, () => ({
          path: require.resolve("zod"),
        }));
      },
    },
  ],
});
