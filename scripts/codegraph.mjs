#!/usr/bin/env node
// codegraph — dependency-free code knowledge graph for TS/JS/Python repos.
//
// Usage: node scripts/codegraph.mjs [rootDir] [outDir]
//
// Emits:
//   <outDir>/graph.json   nodes (files, exports, size, layer) + edges (imports)
//   <outDir>/README.md    layer-level Mermaid map, hubs, cycles, orphans, per-layer file index
//
// The graph is a retrieval aid: ask "who depends on X?" or "what does layer Y touch?"
// without grepping the whole tree. It is regenerated, never hand-edited.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const outDir = path.resolve(process.argv[3] ?? path.join(root, "docs/codegraph"));

const SRC_EXT = [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".py"];
const SKIP_DIR = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", ".venv", "venv",
  "__pycache__", ".cache", "public", "playwright-report", "test-results", "codegraph",
]);

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") && ent.name !== ".github") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIR.has(ent.name)) walk(p, acc);
    } else if (SRC_EXT.includes(path.extname(ent.name)) && !ent.name.endsWith(".d.ts")) {
      acc.push(p);
    }
  }
  return acc;
}

const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const files = walk(root).map(rel).sort();
const fileSet = new Set(files);

// tsconfig "paths" aliases such as "@/*" -> "src/*" (searched in nested projects too)
const aliases = [];
for (const f of [...files.filter((f) => /(^|\/)tsconfig\.json$/.test(f)), "tsconfig.json", "web/tsconfig.json"]) {
  const abs = path.join(root, f);
  if (!fs.existsSync(abs)) continue;
  try {
    const txt = fs.readFileSync(abs, "utf8").replace(/\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
    const cfg = JSON.parse(txt);
    const base = path.posix.join(path.posix.dirname(f), cfg.compilerOptions?.baseUrl ?? ".");
    for (const [k, v] of Object.entries(cfg.compilerOptions?.paths ?? {})) {
      aliases.push({ scope: path.posix.dirname(f), prefix: k.replace(/\*$/, ""), target: path.posix.normalize(path.posix.join(base, String(v[0]).replace(/\*$/, ""))) });
    }
  } catch { /* tolerate odd tsconfigs */ }
}

function resolveTs(from, spec) {
  let base;
  if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else {
    const a = aliases
      .filter((a) => spec.startsWith(a.prefix) && (a.scope === "." || from.startsWith(a.scope + "/")))
      .sort((x, y) => y.scope.length - x.scope.length)[0];
    if (!a) return null;
    base = path.posix.normalize(path.posix.join(a.target, spec.slice(a.prefix.length)));
  }
  const stripped = base.replace(/\.(m?js|jsx)$/, "");
  const cands = [base, ...[".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"].flatMap((e) => [stripped + e, `${base}/index${e}`])];
  return cands.find((c) => fileSet.has(c)) ?? null;
}

function resolvePy(from, mod) {
  const parts = mod.replace(/^\.+/, "");
  const dots = mod.match(/^\.*/)[0].length;
  const bases = [];
  if (dots) {
    let d = path.posix.dirname(from);
    for (let i = 1; i < dots; i++) d = path.posix.dirname(d);
    bases.push(d);
  } else {
    // absolute import: try every directory that is an ancestor of the importing file, plus root
    let d = path.posix.dirname(from);
    while (d && d !== ".") { bases.push(d); d = path.posix.dirname(d); }
    bases.push(".");
    for (const f of files) if (f.endsWith("/pyproject.toml")) bases.push(path.posix.dirname(f));
  }
  for (const b of bases) {
    const p = path.posix.normalize(path.posix.join(b, parts.split(".").join("/")));
    for (const c of [p + ".py", p + "/__init__.py"]) if (fileSet.has(c)) return c;
  }
  return null;
}

const layerOf = (f) => {
  const dirs = f.split("/").slice(0, -1);
  if (!dirs.length) return "(root)";
  const i = dirs.indexOf("src");
  return dirs.slice(0, i >= 0 ? i + 3 : 3).join("/");
};

const nodes = [];
const edges = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  const exportsList = new Set();
  const deps = new Set();
  if (f.endsWith(".py")) {
    for (const m of src.matchAll(/^\s*from\s+([.\w]+)\s+import\s+([^\n#]+)/gm)) {
      const r = resolvePy(f, m[1]);
      if (r) deps.add(r);
      else for (const name of m[2].replace(/[()]/g, "").split(",")) {
        const r2 = resolvePy(f, `${m[1]}.${name.trim().split(/\s+/)[0]}`);
        if (r2) deps.add(r2);
      }
    }
    for (const m of src.matchAll(/^\s*import\s+([\w.]+)/gm)) { const r = resolvePy(f, m[1]); if (r) deps.add(r); }
    for (const m of src.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/gm)) if (!m[1].startsWith("_")) exportsList.add(m[1]);
  } else {
    for (const m of src.matchAll(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
      const r = resolveTs(f, m[1] ?? m[2] ?? m[3] ?? m[4]);
      if (r && r !== f) deps.add(r);
    }
    for (const m of src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) exportsList.add(m[1]);
  }
  const isTest = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[mc]?[jt]sx?$|(^|\/)test_[^/]*\.py$/.test(f);
  nodes.push({ id: f, layer: layerOf(f), loc: src.split("\n").length, test: isTest, exports: [...exportsList].slice(0, 40) });
  for (const d of deps) edges.push({ from: f, to: d });
}

// fan-in / fan-out
const fanIn = new Map(files.map((f) => [f, 0]));
const fanOut = new Map(files.map((f) => [f, 0]));
for (const e of edges) { fanIn.set(e.to, fanIn.get(e.to) + 1); fanOut.set(e.from, fanOut.get(e.from) + 1); }
for (const n of nodes) { n.fanIn = fanIn.get(n.id); n.fanOut = fanOut.get(n.id); }

// strongly connected components (Tarjan) -> import cycles
const adj = new Map(files.map((f) => [f, []]));
for (const e of edges) adj.get(e.from).push(e.to);
let idx = 0; const stack = []; const on = new Set(); const index = new Map(); const low = new Map(); const sccs = [];
function strong(v) {
  index.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v);
  for (const w of adj.get(v)) {
    if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    const comp = []; let w;
    do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v);
    if (comp.length > 1) sccs.push(comp.sort());
  }
}
for (const f of files) if (!index.has(f)) strong(f);

// layer graph (production code only)
const prod = new Set(nodes.filter((n) => !n.test).map((n) => n.id));
const layerOfId = new Map(nodes.map((n) => [n.id, n.layer]));
const layerEdges = new Map();
for (const e of edges) {
  if (!prod.has(e.from) || !prod.has(e.to)) continue;
  const a = layerOfId.get(e.from), b = layerOfId.get(e.to);
  if (a === b) continue;
  const k = `${a}\u0000${b}`;
  layerEdges.set(k, (layerEdges.get(k) ?? 0) + 1);
}
const layerSize = new Map();
for (const n of nodes) if (!n.test) layerSize.set(n.layer, (layerSize.get(n.layer) ?? 0) + 1);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "graph.json"), JSON.stringify({
  generatedBy: "scripts/codegraph.mjs",
  stats: { files: nodes.length, edges: edges.length, tests: nodes.filter((n) => n.test).length, cycles: sccs.length },
  nodes, edges, cycles: sccs,
}, null, 1) + "\n");

// Mermaid: keep the strongest layer edges so the map stays readable
const mid = (s) => "L_" + s.replace(/[^A-Za-z0-9]/g, "_");
const topLayerEdges = [...layerEdges.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45);
const usedLayers = new Set(topLayerEdges.flatMap(([k]) => k.split("\u0000")));
const mermaid = ["flowchart LR"];
for (const l of [...usedLayers].sort()) mermaid.push(`  ${mid(l)}["${l}<br/>${layerSize.get(l) ?? 0} files"]`);
for (const [k, w] of topLayerEdges) { const [a, b] = k.split("\u0000"); mermaid.push(`  ${mid(a)} -->|${w}| ${mid(b)}`); }

const hubs = nodes.filter((n) => !n.test).sort((a, b) => b.fanIn - a.fanIn).slice(0, 15);
const orphans = nodes.filter((n) => !n.test && n.fanIn === 0 && n.fanOut === 0);
const byLayer = new Map();
for (const n of nodes.filter((n) => !n.test)) { if (!byLayer.has(n.layer)) byLayer.set(n.layer, []); byLayer.get(n.layer).push(n); }

const md = [];
md.push("# Code graph", "");
md.push("Generated by `node scripts/codegraph.mjs`. Do not edit by hand; regenerate after structural changes.", "");
md.push(`**${nodes.length}** source files (${nodes.filter((n) => n.test).length} tests) · **${edges.length}** resolved import edges · **${sccs.length}** import cycles · machine-readable: [graph.json](graph.json)`, "");
md.push("## Layer map", "", "Arrows point from importer to imported layer; labels count file-level imports (strongest 45 shown).", "", "```mermaid", ...mermaid, "```", "");
md.push("## Hubs (highest fan-in)", "", "A change here ripples furthest. Test these first.", "", "| File | Imported by | Imports | LOC |", "| --- | ---: | ---: | ---: |");
for (const h of hubs) md.push(`| \`${h.id}\` | ${h.fanIn} | ${h.fanOut} | ${h.loc} |`);
md.push("");
md.push("## Import cycles", "");
if (!sccs.length) md.push("None detected.");
for (const c of sccs) md.push(`- ${c.map((x) => `\`${x}\``).join(" ↔ ")}`);
md.push("");
md.push("## Unconnected production files", "", "No resolved imports in or out. Entry points (routes, scripts, workers) are expected here; anything else may be dead code.", "");
md.push(orphans.length ? orphans.map((o) => `- \`${o.id}\``).join("\n") : "None.");
md.push("");
md.push("## Index by layer", "");
for (const [l, ns] of [...byLayer.entries()].sort()) {
  md.push(`<details><summary><b>${l}</b> · ${ns.length} files</summary>`, "");
  for (const n of ns.sort((a, b) => a.id.localeCompare(b.id))) md.push(`- \`${n.id}\` (in ${n.fanIn} / out ${n.fanOut})${n.exports.length ? ` — ${n.exports.slice(0, 8).map((e) => `\`${e}\``).join(", ")}` : ""}`);
  md.push("", "</details>", "");
}
fs.writeFileSync(path.join(outDir, "README.md"), md.join("\n"));
console.log(`codegraph: ${nodes.length} files, ${edges.length} edges, ${sccs.length} cycles -> ${rel(outDir) || outDir}`);
