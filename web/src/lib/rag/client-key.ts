export const RETRIEVAL_MODE_STORAGE = "intellirag.retrievalMode";
export const TOP_K_STORAGE = "intellirag.topK";
export const VIEW_MODE_STORAGE = "intellirag.view";
export const COACH_DISMISSED_STORAGE = "intellirag.coachDismissed";
const LEGACY_GEMINI_KEY_STORAGE = "intellirag.geminiKey";

export function forgetLegacyClientKeys() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LEGACY_GEMINI_KEY_STORAGE);
}

export function loadRetrievalMode(): "hybrid" | "dense" | "keyword" {
  if (typeof window === "undefined") return "hybrid";
  const v = window.localStorage.getItem(RETRIEVAL_MODE_STORAGE);
  if (v === "dense" || v === "keyword" || v === "hybrid") return v;
  return "hybrid";
}

export function loadTopK(): number {
  if (typeof window === "undefined") return 5;
  const n = Number(window.localStorage.getItem(TOP_K_STORAGE) ?? "5");
  if (!Number.isFinite(n)) return 5;
  return Math.min(12, Math.max(3, Math.round(n)));
}

export function loadViewMode(): "reading" | "lab" {
  if (typeof window === "undefined") return "lab";
  const v = window.localStorage.getItem(VIEW_MODE_STORAGE);
  return v === "reading" ? "reading" : "lab";
}

export function loadCoachDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COACH_DISMISSED_STORAGE) === "1";
}

export function persistCoachDismissed() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COACH_DISMISSED_STORAGE, "1");
}
