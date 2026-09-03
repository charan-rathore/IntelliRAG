export type TourStep = {
  id: string;
  target: string;
  title: string;
  subtitle: string;
  ms: number;
};

/** Cinematic UI tour — subtitles name the control and what it does. */
export const TOUR_STEPS: TourStep[] = [
  {
    id: "brand",
    target: "tour-brand",
    title: "This is the lab",
    subtitle: "The wordmark stays put. Everything else in this tour is a real control on this page — not a mock.",
    ms: 4200,
  },
  {
    id: "view",
    target: "tour-view",
    title: "Reading vs Lab",
    subtitle: "These two tabs. Reading keeps the cited answer. Lab adds dense / BM25 / hybrid / rerank and Used vs Inspect.",
    ms: 4800,
  },
  {
    id: "settings",
    target: "tour-settings",
    title: "Settings (this button)",
    subtitle: "Open this control to paste an OpenRouter key. The key is stored on the server, never in page JavaScript.",
    ms: 4200,
  },
  {
    id: "corpus",
    target: "tour-corpus",
    title: "Corpus rail",
    subtitle: "This left list is the index. Seed docs, a URL, or pasted markdown. Stale vectors get a warning chip.",
    ms: 4500,
  },
  {
    id: "pipeline",
    target: "tour-pipeline",
    title: "The five-step pipeline",
    subtitle: "These five tiles: ask → same 768-d embed → hybrid retrieve → pack by calibrated score → cite or refuse.",
    ms: 5000,
  },
  {
    id: "sample",
    target: "tour-sample",
    title: "Sample source trace",
    subtitle: "This card is the inspector. Used went to Flash. Inspect only was retrieved then dropped.",
    ms: 5000,
  },
  {
    id: "graph",
    target: "tour-graph",
    title: "Knowledge graph",
    subtitle: "This ring is the Graphify cache. Repeat questions hit preferred nodes instead of waiting on Flash.",
    ms: 4800,
  },
  {
    id: "composer",
    target: "tour-composer",
    title: "Ask here",
    subtitle: "This input is the composer. Enter sends. Shift+Enter is a new line. Press / anywhere to focus it.",
    ms: 4500,
  },
  {
    id: "feedback",
    target: "tour-feedback",
    title: "Feedback that rewrites the graph",
    subtitle: "This panel (and the same buttons under each answer): Useful, Dead end, or Correct. Reflect promotes preferred sources.",
    ms: 5000,
  },
];

export const TOUR_STORAGE = "intellirag.tourSeen";

export function loadTourSeen(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(TOUR_STORAGE) === "1";
}

export function persistTourSeen() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOUR_STORAGE, "1");
}
