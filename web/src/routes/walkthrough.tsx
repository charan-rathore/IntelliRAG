import { createFileRoute, Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import walkthrough from '@/data/walkthrough.json';

export const Route = createFileRoute('/walkthrough')({
  head: () => ({ meta: [
    { title: 'One issue. Two questions. — IntelliRAG walkthrough' },
    { name: 'description', content: 'A short, narrated experiment on the public IntelliRAG lab: import a GitHub issue, inspect a cited answer and its graph, test an unsupported question, then reuse the cache.' },
    { property: 'og:image', content: 'https://intellirag-live-own-track.vercel.app/demo/intellirag-walkthrough-poster.jpg' },
  ] }),
  component: Walkthrough,
});

function Walkthrough() {
  const player = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  function seek(at: number) {
    if (!player.current) return;
    player.current.currentTime = at;
    player.current.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    void player.current.play().catch(() => {});
  }
  return <main className="min-h-dvh bg-bg px-4 py-6 text-fg sm:px-8 sm:py-10">
    <div className="mx-auto max-w-6xl">
      <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Walkthrough navigation">
        <Link to="/" className="inline-flex min-h-11 items-center text-primary">← Back to the live lab</Link>
        <span className="font-mono text-xs text-muted">INTELLIRAG / FIELD NOTES 001</span>
      </nav>
      <header className="mb-7 mt-10 grid gap-6 sm:mt-14 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <div><p className="text-xs uppercase tracking-[0.2em] text-primary">A small experiment</p>
          <h1 className="mt-4 font-display text-5xl leading-[1.02] tracking-[-0.05em] sm:text-7xl">One issue.<br /><span className="text-primary">Two questions.</span></h1>
        </div>
        <div><p className="max-w-lg text-base leading-relaxed text-muted">Can we tell evidence from guesswork? Give the lab one GitHub issue. Ask what the source says, then something it cannot know.</p>
          <p id="demo-context" className="mt-4 max-w-lg text-sm leading-relaxed text-muted">The point is simple: an answer is easier to trust when you can inspect its source and see where its knowledge ends.</p>
        </div>
      </header>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 text-xs text-muted sm:px-5"><span className="text-primary">● RECORDED ON THE PUBLIC LAB</span><span>{walkthrough.durationLabel} · voice + music · captions included</span></div>
        <video ref={player} className="aspect-[36/25] w-full bg-black" controls playsInline preload="metadata" poster="/demo/intellirag-walkthrough-poster.jpg" onError={() => setFailed(true)} aria-label="IntelliRAG experiment with visible explanatory captions" aria-describedby="demo-context">
          <source src="/demo/intellirag-walkthrough-narrated.mp4" type="video/mp4" />
          <track kind="captions" src="/demo/intellirag-walkthrough.vtt" srcLang="en" label="English" />
          Your browser cannot play this video. <a href="/demo/intellirag-walkthrough-narrated.mp4">Download the MP4.</a>
        </video>
        {failed ? <p role="alert" className="border-t border-border p-4 text-sm text-muted">Playback could not load. <a className="text-primary underline" href="/demo/intellirag-walkthrough-narrated.mp4">Open or download the MP4</a>, or use the transcript below.</p> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted"><p>Real actions and responses. Original script, synthetic voice and original music.</p><a className="inline-flex min-h-11 items-center text-primary underline" href="/demo/intellirag-walkthrough-narrated.mp4" download>Download MP4 ↓</a></div>
      <nav className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Video chapters">
        {walkthrough.chapters.map(chapter => <button key={chapter.at} type="button" onClick={() => seek(chapter.at)} className="flex min-h-16 items-start gap-3 rounded-lg border border-border bg-raised p-4 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary">
          <span className="font-mono text-xs text-primary">{chapter.time}</span><span className="text-sm">{chapter.title}</span>
        </button>)}
      </nav>
      <div className="mt-7 grid gap-4 sm:grid-cols-3">
        {[['The source', 'A public node-postgres issue proposing a SQL tagged template function.'], ['The check', 'A source-backed question, an unsupported question, and a repeat query to inspect cache reuse.'], ['The result', 'Cited evidence, a refusal where evidence is missing, and a reusable answer with its citations attached.']].map(([title, copy]) => <div className="border-t border-border pt-4" key={title}><h2 className="text-sm font-medium text-fg">{title}</h2><p className="mt-2 text-sm leading-relaxed text-muted">{copy}</p></div>)}
      </div>
      <p className="mt-7 rounded-lg border border-border bg-raised p-4 text-xs leading-relaxed text-muted">This recording uses keyword retrieval and cited extracts; no language model generates its answers. The graph uses extracted structure and inferred lexical connections. Imports on this unconfigured deployment are temporary. Persistent storage and hybrid/model-backed runs require Postgres and provider configuration.</p>
      <details className="mt-5 rounded-lg border border-border p-5">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">Read the full experiment transcript</summary>
        <ol className="mt-4 space-y-5">
          {walkthrough.chapters.map(chapter => <li key={chapter.at}><h3 className="text-sm text-fg"><span className="mr-3 font-mono text-xs text-primary">{chapter.time}</span>{chapter.title}</h3><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{chapter.narration}</p></li>)}
        </ol>
        <a className="mt-5 inline-flex min-h-11 items-center text-sm text-primary underline" href="https://github.com/brianc/node-postgres/issues/3745" target="_blank" rel="noreferrer">Read the original GitHub issue ↗</a>
      </details>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6"><p className="text-sm text-muted">Try the same check on a source you know.</p><Link to="/" className="inline-flex min-h-12 items-center rounded-md bg-primary px-5 text-sm font-medium text-bg">Bring your own issue →</Link></div>
    </div>
  </main>;
}
