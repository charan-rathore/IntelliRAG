export type TourStep = {
  id: string;
  target: string;
  title: string;
  subtitle: string;
  ms: number;
};

/** Cinematic UI tour. subtitles name the control and what it does. */
export const TOUR_STEPS: TourStep[] = [
  { id: 'brand', target: 'tour-brand', title: 'Your source-backed workspace', subtitle: 'Bring documents, ask a question, and check the evidence behind the answer.', ms: 4000 },
  { id: 'sources', target: 'tour-sources', title: 'Bring a source', subtitle: 'Sources opens document import and corpus selection. Close it when you want to focus on the answer.', ms: 4500 },
  { id: 'view', target: 'tour-view', title: 'Choose your reading depth', subtitle: 'Reading keeps the answer concise. Lab adds retrieval details to the conversation.', ms: 4000 },
  { id: 'evidence', target: 'tour-evidence', title: 'Follow the evidence', subtitle: 'Evidence opens source traces, the explorable graph and feedback history. These details stay tucked away until you need them.', ms: 4500 },
  { id: 'composer', target: 'tour-composer', title: 'Ask what you need to know', subtitle: 'Enter sends your question. Cited passages support the answer; missing evidence should produce a refusal.', ms: 4500 },
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
