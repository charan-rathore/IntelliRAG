/**
 * The conversation the client sends with each question, built from the turns
 * it already shows. Pure, so what gets sent is exactly what the tests check.
 */
import type { SessionTurn } from "./session-intent";

export interface AskedTurn {
  role: "user" | "assistant";
  asked?: string;
  error?: string;
  stage?: string;
  coverage?: string;
  corpusId?: string | null;
  chunks?: Array<{ chunkId: string; text: string; heading?: string | null }>;
  feedback?: "useful" | "dead_end" | "corrected" | null;
}

export const HISTORY_TURNS = 8;
const PASSAGES_PER_TURN = 3;
const PASSAGE_CHARS = 4000;

/**
 * Earlier finished answers on the same source, newest last, starting at
 * `from` (where the person last chose "New topic"). A thumbs-up marks that
 * answer's passages helpful, a dead end marks them unhelpful.
 */
export function historyFrom(turns: AskedTurn[], corpus: string | null, from = 0): SessionTurn[] {
  return turns
    .slice(from)
    .filter((t) => t.role === "assistant" && t.asked && !t.error && !t.stage && (t.corpusId == null || corpus == null || t.corpusId === corpus))
    .slice(-HISTORY_TURNS)
    .map((t) => {
      const packed = (t.chunks ?? []).slice(0, PASSAGES_PER_TURN).map((c) => ({ chunkId: c.chunkId, text: c.text.slice(0, PASSAGE_CHARS), heading: c.heading ?? null }));
      const vote = t.feedback === "useful" ? 1 : t.feedback === "dead_end" ? -1 : 0;
      return {
        query: t.asked!,
        refused: t.coverage === "refused",
        ...(packed.length ? { packed } : {}),
        ...(vote && packed.length ? { feedback: Object.fromEntries(packed.map((p) => [p.chunkId, vote as 1 | -1])) } : {}),
      };
    });
}
