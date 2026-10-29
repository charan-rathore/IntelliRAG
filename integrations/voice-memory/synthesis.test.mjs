import { test } from "node:test";
import assert from "node:assert/strict";
import { importBundle } from "./dist/engine.mjs";
import { synthesize, validateSynthesis } from "./synthesis.mjs";
const bundle = () =>
  importBundle([
    {
      title: "Security condition",
      text: "Launch is proposed for Tuesday only after security signs off. Security approval is pending.",
    },
  ]);
function result(b) {
  const s = b.sources[0];
  return {
    summary: "The proposed date is conditional.",
    items: [
      {
        kind: "inference",
        text: "Treating Tuesday as unconditional would drop the recorded prerequisite.",
        uncertainty: "No source establishes completed security sign-off.",
        evidence: [
          {
            sourceId: s.id,
            hash: s.hash,
            start: 0,
            end: s.text.length,
            quote: s.text,
          },
        ],
      },
    ],
    draft: {
      subject: "Confirm security sign-off before announcing launch",
      body: "Can you confirm who owns security sign-off and provide the approval record before we communicate a firm launch date?",
    },
  };
}
test("no provider means no model request", async () => {
  await assert.rejects(
    synthesize("launch?", bundle()),
    /No synthesis provider/,
  );
});
test("injected fixture tests contract only, not actual model quality", async () => {
  const b = bundle(),
    r = await synthesize("launch?", b, async (packet) => {
      assert.match(packet.instructions, /untrusted/);
      return result(b);
    });
  assert.match(r.validationNotice, /require review/);
});
test("unsupported claim and wrong source quote rejected", () => {
  const b = bundle(),
    r = result(b);
  r.items[0].evidence[0].quote = "Launch approved.";
  assert.throws(() => validateSynthesis(r, b));
});
test("inference missing uncertainty rejected", () => {
  const b = bundle(),
    r = result(b);
  delete r.items[0].uncertainty;
  assert.throws(() => validateSynthesis(r, b));
});
test("fact without evidence rejected", () => {
  const b = bundle(),
    r = result(b);
  r.items[0].kind = "fact";
  r.items[0].evidence = [];
  assert.throws(() => validateSynthesis(r, b));
});
test("cancellation prevents provider execution", async () => {
  let called = false;
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    synthesize(
      "launch?",
      bundle(),
      async () => {
        called = true;
      },
      { signal: c.signal },
    ),
  );
  assert.equal(called, false);
});

test("provider source packet includes exact UTF16 offsets alongside line numbers", async () => {
  const b = importBundle([
    {
      title: "Unicode",
      text: "Budget ₹50000 is proposed.\nSecurity 😀 sign-off remains pending for the pilot.",
    },
  ]);
  await synthesize("security", b, async (packet) => {
    const source = packet.sources[0];
    for (const line of source.lines)
      assert.equal(b.sources[0].text.slice(line.start, line.end), line.text);
    return result(b);
  });
});

test("schema validation does not imply a free-form draft is supported", () => {
  const b = bundle(),
    r = result(b);
  r.draft.body = "Launch definitely approved on Tuesday.";
  const out = validateSynthesis(r, b);
  assert.equal(out.draftReviewRequired, true);
  assert.match(out.validationNotice, /draft factuality.*require review/);
});
