import type { QueryIntent } from "./types";

const GREET = /^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/i;
const CAPABILITY =
  /\b(what can you do|how does this work|help|capabilities|what (are|is) you)\b/i;

/**
 * Only greetings and capability questions skip retrieval.
 * Grounding (including "off-topic") is decided from retrieved evidence, not regexes.
 */
export function classifyIntent(question: string): QueryIntent {
  const q = question.trim();
  if (q.length < 24 && GREET.test(q)) return "greeting";
  if (CAPABILITY.test(q)) return "capability";
  return "document";
}
