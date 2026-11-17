import { distinctiveTerms } from "./ranking";
import { tokenSetMatches } from "./text";

export const EXPLICIT_FOCUS_POLICY = "explicit-focus-v2-single-hit";

const WORD = "[\\p{L}\\p{N}][\\p{L}\\p{N}-]*";
const SUBJECT_PREDICATES = [
  "produce",
  "create",
  "make",
  "generate",
  "form",
  "cause",
  "support",
  "handle",
  "store",
  "process",
  "use",
];

const SUBJECT_FOCUS = new RegExp(
  `\\bhow\\s+(?:does|did)\\s+(?:(?:a|an|the)\\s+)?(${WORD})\\s+(?:${SUBJECT_PREDICATES.join("|")})\\b`,
  "iu",
);

const OBJECT_FOCUS = new RegExp(
  `(?:^|[.!?]\\s+)(?:(?:tell|show|give)\\s+(?:me|us)|(?:explain|describe))\\s+(?:the|a|an)\\s+(${WORD}(?:\\s+${WORD}){0,2})(?=[.!?]|$)`,
  "giu",
);

function topicTerms(phrase: string): string[] {
  return [...new Set(distinctiveTerms(phrase))];
}

/** A deliberately narrow topic read for the one-overlap false-positive cases. */
export function explicitFocusTerms(query: string): string[] | null {
  const subject = SUBJECT_FOCUS.exec(query.trim());
  if (subject?.[1]) {
    const terms = topicTerms(subject[1]);
    return terms.length ? terms : null;
  }

  OBJECT_FOCUS.lastIndex = 0;
  const object = OBJECT_FOCUS.exec(query.trim());
  if (object?.[1]) {
    const terms = topicTerms(object[1]);
    return terms.length ? terms : null;
  }
  return null;
}

/** Return the distinctive explicit-focus terms missing from already-computed packed tokens. */
export function missingExplicitFocusTerms(query: string, packedTokens: Set<string>): string[] {
  const terms = explicitFocusTerms(query);
  if (!terms?.length) return [];
  return terms.filter((term) => !tokenSetMatches(term, packedTokens));
}
