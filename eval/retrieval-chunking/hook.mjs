import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith(".") || spec.startsWith("/")) && !/\.[cm]?[jt]sx?$/.test(spec) && ctx.parentURL) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const u = new URL(spec + ext, ctx.parentURL);
      if (existsSync(fileURLToPath(u))) return next(u.href, ctx);
    }
  }
  if (spec.startsWith("@/")) { /* alias */ 
    const base = new URL("file://../../web/src/");
    for (const ext of [".ts", ".tsx", "/index.ts"]) { const u = new URL(spec.slice(2)+ext, base); if (existsSync(fileURLToPath(u))) return next(u.href, ctx); }
  }
  return next(spec, ctx);
}
