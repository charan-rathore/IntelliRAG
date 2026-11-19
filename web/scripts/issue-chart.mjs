// Draws eval/github-issues/chart.svg from results.json: Acc@k before and after,
// and every issue whose fix file moved into or out of the top 5.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve(import.meta.dirname, '../../eval/github-issues');
const d = JSON.parse(readFileSync(dir + '/results.json', 'utf8'));
const iss = d.issues;
const acc = (arm, k) => iss.filter((i) => i.rank[arm] !== null && i.rank[arm] <= k).length / iss.length;
const W = 880, pad = 40;
const ink = '#1c1c19', muted = '#55554e', subtle = '#6b6b63', line = '#e3e2da', before = '#c9c8bd', now = '#2f6f45', bad = '#b42318';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let y = 56;
const out = [];
out.push(`<text x="${pad}" y="32" font-size="18" font-weight="600" fill="${ink}">Finding the file a real GitHub issue lives in</text>`);
out.push(`<text x="${pad}" y="50" font-size="12" fill="${muted}">${iss.length} SWE-bench Lite issues from pytest, sphinx, scikit-learn and django · IntelliRAG's retrieval, before and after code links</text>`);
y = 84;
const groupW = 230, barH = 18;
[1, 3, 5].forEach((k, gi) => {
  const x0 = pad + gi * (groupW + 30);
  const b = acc('before', k), a = acc('retrieval', k);
  out.push(`<text x="${x0}" y="${y}" font-size="12" font-weight="600" fill="${ink}">Right file in top ${k}</text>`);
  [['before', b, before], ['now', a, now]].forEach(([label, v, c], j) => {
    const yy = y + 12 + j * (barH + 8);
    out.push(`<rect x="${x0}" y="${yy}" width="${groupW - 60}" height="${barH}" rx="4" fill="#efeee6"/>`);
    out.push(`<rect x="${x0}" y="${yy}" width="${((groupW - 60) * v).toFixed(1)}" height="${barH}" rx="4" fill="${c}"/>`);
    out.push(`<text x="${x0 + groupW - 54}" y="${yy + 13}" font-size="12" font-family="ui-monospace,monospace" fill="${j ? now : subtle}" font-weight="${j ? 600 : 400}">${(100 * v).toFixed(1)}%</text>`);
    out.push(`<text x="${x0 + 6}" y="${yy + 13}" font-size="11" fill="${j ? '#fff' : ink}">${label}</text>`);
  });
});
y += 90;
const moved = iss.filter((i) => ((i.rank.before ?? 99) > 5) !== ((i.rank.retrieval ?? 99) > 5))
  .sort((p, q) => ((q.rank.before ?? 99) - (q.rank.retrieval ?? 99)) - ((p.rank.before ?? 99) - (p.rank.retrieval ?? 99)));
out.push(`<text x="${pad}" y="${y}" font-size="12" font-weight="600" fill="${ink}">Issues that moved in or out of the top 5 (rank of the fix file, before → now)</text>`);
y += 10;
const scaleX = (r) => 560 + Math.min(r ?? 25, 25) * 11;
out.push(`<text x="${scaleX(1) - 4}" y="${y + 8}" font-size="10" fill="${subtle}">1</text><text x="${scaleX(5) - 4}" y="${y + 8}" font-size="10" fill="${subtle}">5</text><text x="${scaleX(10) - 6}" y="${y + 8}" font-size="10" fill="${subtle}">10</text><text x="${scaleX(25) - 12}" y="${y + 8}" font-size="10" fill="${subtle}">25+</text>`);
y += 14;
const top5Line = scaleX(5.5);
const rowsStart = y;
for (const i of moved) {
  const b = i.rank.before, a = i.rank.retrieval;
  const gain = (b ?? 99) > (a ?? 99);
  out.push(`<a href="${i.url}"><text x="${pad}" y="${y + 12}" font-size="11.5" fill="${ink}">${esc(i.id.replace('__', '/').replace(/-(\d+)$/, ' #$1'))}</text>`);
  out.push(`<text x="${pad + 205}" y="${y + 12}" font-size="11.5" fill="${muted}">${esc(i.title.slice(0, 50))}${i.title.length > 50 ? '…' : ''}</text></a>`);
  out.push(`<line x1="${scaleX(b)}" y1="${y + 8}" x2="${scaleX(a)}" y2="${y + 8}" stroke="${gain ? now : bad}" stroke-width="2"/>`);
  out.push(`<circle cx="${scaleX(b)}" cy="${y + 8}" r="4" fill="${before}"/><circle cx="${scaleX(a)}" cy="${y + 8}" r="5" fill="${gain ? now : bad}"/>`);
  y += 22;
}
out.unshift(`<line x1="${top5Line}" y1="${rowsStart - 4}" x2="${top5Line}" y2="${y}" stroke="${line}" stroke-dasharray="3 3"/>`);
y += 16;
out.push(`<text x="${pad}" y="${y}" font-size="11" fill="${subtle}">Green: newly found. Red: dropped out. Click an issue to open the pull request that fixed it. No model involved; tuned on sympy issues only.</text>`);
const H = y + 20;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Geist, Inter, Segoe UI, system-ui, sans-serif"><rect width="${W}" height="${H}" fill="#ffffff"/>${out.join('')}</svg>`;
writeFileSync(dir + '/chart.svg', svg);
console.log('wrote chart.svg', moved.length, 'moved');
