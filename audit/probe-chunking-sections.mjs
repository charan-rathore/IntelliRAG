const { chunkDocument } = await import(process.argv[2]);
const sec = (h, w) => `${h}\n\n` + Array.from({length: 120}, (_, i) => `${w}${i} alpha beta gamma.`).join(" ");
const doc = ["# Guide", sec("##### Concurrency", "conc"), sec("###### Rate limit", "rate"), sec("## Events", "evt")].join("\n\n");
const cs = chunkDocument(doc, { chunkSize: 200, overlap: 40 });
let cross = 0, midword = 0;
for (const c of cs) {
  const firstWord = c.text.split(/\s/)[0];
  if (/^[a-z]+\d*$/.test(firstWord) && !/^(conc|rate|evt|alpha|beta|gamma)/.test(firstWord)) midword++;
  if (c.heading?.endsWith("Rate limit") && /conc\d/.test(c.text)) cross++;
  if (c.heading?.endsWith("Events") && /rate\d/.test(c.text)) cross++;
}
const heads = [...new Set(cs.map(c => c.heading))];
console.log(JSON.stringify({ chunks: cs.length, heads, crossSectionOverlap: cross, midWordStarts: midword, firstWords: cs.map(c=>c.text.split(/\s/)[0]) }));
