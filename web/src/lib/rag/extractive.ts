import type { RetrievedChunk } from './types';
import { contentTokens } from './text';

/**
 * An answer without a model: the sentences of the packed sources that speak
 * to the question, under the API name or heading they belong to, each cited,
 * plus the one code example that matches best. Every word is the source's;
 * nothing is paraphrased. It used to paste whole packed windows, raw Markdown
 * and all, which read as noise.
 */
interface Unit { kind: 'sentence' | 'code'; text: string; heading: string | null; source: number; order: number }

const cleanInline = (s: string) =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((?:#|https?:)[^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const CODEISH = /(;\s*$|=>|^\s*\/\/|^\s*(const|let|var|await|import|export|return|function|class|if|for|try|catch|\}|\{)\b|^\s*[\w$.]+\([^)]*\);?\s*$)/;

/**
 * A packed window can begin inside a code block (chunks split anywhere), which
 * flips every fence after it. With an odd number of fences, the window began
 * in code if the lines before its first fence read as code.
 */
function startsInCode(lines: string[]): boolean {
  const fences = lines.filter((l) => /^\s*(```|~~~)/.test(l)).length;
  if (fences % 2 === 0) return false;
  const first = lines.findIndex((l) => /^\s*(```|~~~)/.test(l));
  const before = lines.slice(0, first).filter((l) => l.trim());
  if (!before.length) return false;
  return before.filter((l) => CODEISH.test(l)).length >= before.length / 2;
}

function unitsOf(text: string, source: number, start: number): Unit[] {
  const out: Unit[] = [];
  let heading: string | null = null;
  const all = text.split('\n');
  let code: string[] | null = startsInCode(all) ? [] : null;
  let para: string[] = [];
  let order = start;
  const flush = () => {
    const body = cleanInline(para.join(' '));
    para = [];
    if (!body) return;
    for (const s of body.split(/(?<=[.!?])\s+(?=[A-Z`(])/)) {
      const t = s.trim();
      // Code that slipped outside a fence isn't a sentence.
      if (t.length >= 12 && /[a-z]{3}/i.test(t) && !CODEISH.test(t) && /\s/.test(t)) out.push({ kind: 'sentence', text: t, heading, source, order: order++ });
    }
  };
  for (const raw of all) {
    // Callouts ("> [!NOTE]") and quote markers are presentation, not words.
    const line = raw.replace(/\s+$/, '').replace(/^\s*>\s?/, '').replace(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/i, '');
    if (code) {
      if (/^\s*(```|~~~)/.test(line)) { out.push({ kind: 'code', text: code.join('\n'), heading, source, order: order++ }); code = null; }
      else code.push(line);
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) { flush(); code = []; continue; }
    const h = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (h) { flush(); heading = cleanInline(h[1]!).replace(/^`|`$/g, ''); continue; }
    if (!line.trim()) { flush(); continue; }
    // Bullets and table rows read as their own sentences.
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) { flush(); para.push(line.replace(/^\s*([-*+]|\d+[.)])\s+/, '')); flush(); continue; }
    if (/^\s*\|/.test(line)) continue;
    para.push(line.trim());
  }
  flush();
  if (code && (code as string[]).length) out.push({ kind: 'code', text: (code as string[]).join('\n'), heading, source, order: order++ });
  return out;
}

export function extractiveAnswer(question: string, chunks: RetrievedChunk[], opts: { maxPoints?: number } = {}): string {
  const sources = chunks.slice(0, 3);
  if (!sources.length) return 'No passage in the source answers this.';
  const q = new Set(contentTokens(question));
  const units = sources.flatMap((c, i) => unitsOf(c.text, i + 1, i * 1000));
  // idf over the packed sentences: words every sentence shares say little.
  const df = new Map<string, number>();
  for (const u of units) for (const t of new Set(contentTokens(`${u.heading ?? ''} ${u.text}`))) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + units.length / (1 + (df.get(t) ?? 0)));
  const score = (u: Unit) => {
    const own = new Set(contentTokens(u.text));
    const head = new Set(contentTokens(u.heading ?? ''));
    let s = 0;
    for (const t of q) { if (own.has(t)) s += idf(t); else if (head.has(t)) s += 0.6 * idf(t); }
    return s;
  };
  const scored = units.map((u) => ({ u, s: score(u) }));
  const max = opts.maxPoints ?? 5;
  const top = Math.max(0, ...scored.filter((x) => x.u.kind === 'sentence').map((x) => x.s));
  const points = scored
    .filter((x) => x.u.kind === 'sentence' && x.s > 0 && x.s >= 0.4 * top)
    .sort((a, b) => b.s - a.s)
    .filter((x, i, all) => {
      // Near-duplicates (the same point said twice) count once.
      const words = new Set(contentTokens(x.u.text));
      return !all.slice(0, i).some((y) => { const o = contentTokens(y.u.text).filter((t) => words.has(t)).length; return o >= 0.7 * Math.min(words.size, new Set(contentTokens(y.u.text)).size); });
    })
    .slice(0, max);
  // A condition that follows a quoted point travels with it: "Except
  // payments." or "It must not restart with the cover open." changes what the
  // point means, so it's never cut away.
  const QUALIFIER = /^(except|unless|but|however|only|note|it must|must not|do not|don't|never|this does not|that does not)\b/i;
  for (const x of [...points]) {
    const next = units.find((u) => u.order === x.u.order + 1 && u.kind === 'sentence' && u.source === x.u.source);
    if (next && QUALIFIER.test(next.text) && !points.some((p) => p.u === next)) points.push({ u: next, s: x.s });
  }
  points.sort((a, b) => a.u.order - b.u.order);
  const example = scored.filter((x) => x.u.kind === 'code' && x.s > 0).sort((a, b) => b.s - a.s)[0]?.u;

  const lines: string[] = [];
  if (!points.length) {
    // Nothing matches word for word: show the opening of each source, briefly.
    lines.push('The closest passages, quoted:');
    for (const u of units.filter((x) => x.kind === 'sentence').slice(0, 3)) lines.push(`- ${u.heading ? `\`${u.heading}\`: ` : ''}${u.text} [Source ${u.source}]`);
  } else {
    lines.push('What the source says about this:');
    for (const { u } of points) {
      const lead = u.heading && !u.text.includes(u.heading) ? `**${u.heading.startsWith('.') || /\(\)$/.test(u.heading) ? `\`${u.heading}\`` : u.heading}**: ` : '';
      lines.push(`- ${lead}${u.text} [Source ${u.source}]`);
    }
  }
  if (example) {
    const code = example.text.split('\n').slice(0, 14).join('\n');
    lines.push('', `Example${example.heading ? ` from ${example.heading}` : ''} [Source ${example.source}]:`, '```', code, '```');
  }
  lines.push('', '_Quoted from the source, not generated. Add a model in Settings for a written answer._');
  return lines.join('\n');
}
