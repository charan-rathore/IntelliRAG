import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocate, consolidateLexicon, dreamsFor, emptyJournal, identifierWords, replayProbes, sleep, type SleepEnv, type SleepJournal } from "./sleep.ts";
import { emptyExperience, recordExperience, MAX_DREAMS_PER_PASSAGE, type ExperienceLog } from "./experience.ts";

const P = [
  { chunkId: "a", text: "Call onSizeLessThan(limit) to wait until the queue has room.", heading: "Backpressure", filepath: "readme.md" },
  { chunkId: "b", text: "pause() stops the queue from starting new tasks; start() resumes it.", heading: "Pausing", filepath: "readme.md" },
  { chunkId: "c", text: "The timeout option bounds how long one task may run.", heading: "Timeouts", filepath: "readme.md" },
];

/** A toy retriever: a passage is packed when it shares a word with the question, its text or its learned wordings. */
function toyEnv(extra: Partial<SleepEnv> = {}): SleepEnv {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{3,}/g) ?? []);
  return {
    corpusId: "c",
    passages: P,
    packed: (q, log) => {
      const qw = words(q);
      return P.filter((p) => {
        const learned = log.entries[`c\u0000${p.chunkId}`]?.asked.filter((a) => a.vote > 0).map((a) => a.q).join(" ") ?? "";
        return [...words(`${p.text} ${learned}`)].some((w) => qw.has(w));
      }).map((p) => p.chunkId);
    },
    ...extra,
  };
}

describe("dreaming", () => {
  it("splits identifiers into the words people type", () => {
    assert.deepEqual(identifierWords("onSizeLessThan"), ["on", "size", "less", "than"]);
    assert.deepEqual(identifierWords("HTTPServer_error"), ["http", "server", "error"]);
  });

  it("dreams only in words the passage doesn't already spell out", () => {
    const qs = dreamsFor(P[0]!, "identifiers", { lexicon: new Map(), idf: () => 1 });
    assert.deepEqual(qs, ["on size less than"]);
    assert.deepEqual(dreamsFor(P[2]!, "identifiers", { lexicon: new Map(), idf: () => 1 }), []);
  });

  it("keeps a dream that lets a passage be found, and journals the rest with reasons", () => {
    const r = sleep(toyEnv(), emptyExperience(), emptyJournal(), { now: "2026-11-19T00:00:00Z" });
    const kept = r.cycle.kept.find((k) => k.chunkId === "a");
    assert.equal(kept?.question, "on size less than");
    const dreamt = r.log.entries["c\u0000a"]!.asked.find((x) => x.by === "dream");
    assert.equal(dreamt?.strategy, "identifiers");
    const id = r.journal.totals.identifiers!;
    assert.ok(id.proposed >= id.accepted && id.accepted >= 1);
  });

  it("rejects a dream that would cost a question people confirmed (no forgetting)", () => {
    // People confirmed passage c for a "size" question. In this retriever only
    // one passage is packed per "size" question, and a dream on a would take
    // that slot: the sleep must not keep it.
    const log = recordExperience(emptyExperience(), { corpusId: "c", question: "size less of a task", passages: [P[2]!], vote: 1 });
    const hasDream = (l: ExperienceLog) => Boolean(l.entries["c\u0000a"]?.asked.some((x) => x.by === "dream"));
    const env = toyEnv({ packed: (q, l) => (q.includes("size") ? (hasDream(l) ? ["a"] : ["c"]) : toyEnv().packed(q, l)) });
    const r = sleep(env, log, emptyJournal(), { now: "2026-11-19T00:00:00Z" });
    assert.equal(r.cycle.replay.before, 1);
    assert.equal(r.cycle.replay.after, 1);
    assert.ok(!r.cycle.kept.some((k) => k.chunkId === "a"));
    assert.equal(r.journal.totals.identifiers?.rejected.forgetting, 1);
    assert.equal(r.journal.totals.context?.rejected.forgetting, 1);
  });

  it("a person's dead end retires dreams like it; dreams never crowd out people", () => {
    let log = emptyExperience();
    for (let i = 0; i < 6; i++) log = recordExperience(log, { corpusId: "c", question: `dream wording ${i} size`, passages: [P[0]!], vote: 1, dream: { strategy: "identifiers" } });
    assert.equal(log.entries["c\u0000a"]!.asked.filter((a) => a.by === "dream").length, MAX_DREAMS_PER_PASSAGE);
    log = recordExperience(log, { corpusId: "c", question: "dream wording size", passages: [P[0]!], vote: -1 });
    assert.equal(log.entries["c\u0000a"]!.asked.filter((a) => a.by === "dream").length, 0);
    assert.equal(replayProbes(log, "c").length, 1);
  });
});

describe("consolidation and the journal", () => {
  it("learns which words people use for the source's words", () => {
    const pairs = [
      { q: "throttle calls", text: "intervalCap and interval limit starts" },
      { q: "throttle requests", text: "set intervalCap with an interval" },
      { q: "hold jobs", text: "pause the queue" },
    ];
    const lex = consolidateLexicon(pairs, () => 1, { minCount: 2 });
    assert.ok([...lex.values()].some((l) => l.some((x) => x.term === "throttle")));
  });

  it("pauses a strategy that kept nothing two sleeps running, and brings it back after", () => {
    const failing = { proposed: 3, accepted: 0, rejected: { "no-gain": 3 }, budget: 3, rationale: "" };
    const cycle = { at: "", replay: { total: 0, before: 0, after: 0 }, lexicon: 0, kept: [], strategies: { context: failing, identifiers: { ...failing, accepted: 2 } } };
    const j: SleepJournal = { version: 1, cycles: [cycle, cycle], totals: { context: { proposed: 6, accepted: 0, rejected: {} }, identifiers: { proposed: 6, accepted: 4, rejected: {} } } };
    const plan = allocate(j, 20, ["identifiers", "context"]);
    assert.equal(plan.get("context")!.paused, true);
    assert.ok(plan.get("identifiers")!.budget > 0);
    const later = allocate({ ...j, cycles: [cycle, { ...cycle, strategies: {} }] }, 20, ["identifiers", "context"]);
    assert.equal(later.get("context")!.paused, false);
  });
});
