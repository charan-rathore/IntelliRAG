/**
 * Answers never stop mid-sentence.
 *
 * A model that runs out of output budget used to fail the whole answer, or, while
 * streaming, leave half a sentence on screen. Now a budget stop is treated as
 * "not finished yet": the model is asked to continue from exactly where it
 * stopped (up to two more turns). If it still can't finish, the text is cut back
 * to its last complete sentence, list item or paragraph, any open code block is
 * closed, and a one-line note says the answer was shortened, so what the
 * person reads is always whole.
 */
import { GenerationError } from "./generation-result";

export const SHORTENED_NOTE = "_Shortened to fit. Ask a follow-up for the rest._";

/** Cut text back to its last complete unit and close what's open. */
export function trimToComplete(text: string): string {
  let t = text.replace(/\s+$/, "");
  if (!t) return t;
  const fences = (t.match(/^\s*```/gm) ?? []).length;
  if (fences % 2 === 1) {
    // An unfinished code block: keep it only if it has whole lines, then close it.
    const lastNl = t.lastIndexOf("\n");
    t = (lastNl > 0 ? t.slice(0, lastNl) : t) + "\n```";
    return t;
  }
  // A whole paragraph or list item already ends cleanly.
  if (/[.!?:)\]`*_"'”’]$/.test(t) && !/\b(e\.g|i\.e|etc|vs|Fig|Eq)\.$/.test(t)) return t;
  const lines = t.split("\n");
  const last = lines.at(-1)!;
  // A list item or table row cut mid-line: drop that line.
  if (/^\s*([-*+]|\d+[.)]|\|)/.test(last) && lines.length > 1) return trimToComplete(lines.slice(0, -1).join("\n"));
  // Otherwise back up to the last sentence end in the paragraph.
  const m = [...t.matchAll(/[.!?](?=["'”’)\]]?\s)/g)].at(-1);
  if (m && m.index !== undefined && m.index > t.length * 0.3) return t.slice(0, m.index + 1);
  const para = t.lastIndexOf("\n\n");
  return para > 0 ? t.slice(0, para) : t;
}

export interface ContinueOpts {
  /** One generation turn. `soFar` is the answer already produced, empty on the first turn. */
  turn: (soFar: string) => Promise<string>;
  maxContinuations?: number;
}

/** Run a generation, continuing after budget stops, and always return a whole answer. */
export async function completeAnswer(opts: ContinueOpts): Promise<{ text: string; continued: number; shortened: boolean }> {
  const max = opts.maxContinuations ?? 2;
  let soFar = "";
  for (let i = 0; i <= max; i++) {
    try {
      const piece = await opts.turn(soFar);
      return { text: joinPieces(soFar, piece), continued: i, shortened: false };
    } catch (error) {
      if (!(error instanceof GenerationError) || error.reason !== "output_budget_exhausted") throw error;
      const partial = error.partial ?? "";
      if (!partial.trim() && !soFar) throw error;
      soFar = joinPieces(soFar, partial);
    }
  }
  return { text: `${trimToComplete(soFar)}\n\n${SHORTENED_NOTE}`, continued: max, shortened: true };
}

/** A continuation sometimes repeats the tail it was shown; drop the overlap. */
export function joinPieces(a: string, b: string): string {
  if (!a) return b;
  const tail = a.slice(-200);
  for (let k = Math.min(tail.length, b.length); k >= 12; k--) if (tail.endsWith(b.slice(0, k))) return a + b.slice(k);
  return a + b;
}

/** The user message for a continuation turn. */
export function continuationPrompt(user: string, soFar: string): string {
  return `${user}\n\n---\nYou ran out of space mid-answer. Here is the answer so far:\n\n${soFar}\n\n---\nContinue from exactly where it stops. Don't repeat anything, don't restart, keep the same citations style, and finish the answer.`;
}
