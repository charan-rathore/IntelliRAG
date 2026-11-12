import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  answerCacheKey,
  CONTRACT_VERSION,
  validateEvidencePackage,
  type EvidencePackage,
} from "../evidence-core/contracts.ts";
import { answerSentenceClaim, citationToSpan } from "../evidence-core/intellirag-adapter.ts";

const here = new URL("../evidence-core/", import.meta.url);
const fixture = JSON.parse(readFileSync(new URL("evidence-package.fixture.json", here), "utf8"));
const pkg = fixture.package as EvidencePackage;
const clone = (): EvidencePackage => structuredClone(pkg);
const rules = (p: EvidencePackage) => validateEvidencePackage(p).map((i) => i.rule);
const pinned = JSON.parse(readFileSync(new URL("../../data/pqueue-demo.json", here), "utf8")).body as string;

describe("evidence core contract (shared with memoRABLE)", () => {
  it("is byte-identical to the copy the fixture was generated from", () => {
    const text = readFileSync(new URL("contracts.ts", here), "utf8").replace(/\r\n/g, "\n");
    assert.equal(createHash("sha256").update(text).digest("hex"), fixture.contractSha256,
      "contracts.ts changed: copy it to memoRABLE src/evidence-core/ and regenerate both fixtures");
  });

  it("accepts the shared fixture", () => {
    assert.equal(pkg.contractVersion, CONTRACT_VERSION);
    assert.deepEqual(validateEvidencePackage(pkg), []);
  });

  it("anchors the fixture to the real pinned p-queue source", () => {
    const sv = pkg.sourceVersions[0];
    assert.equal(createHash("sha256").update(pinned).digest("hex"), sv.contentHash);
    const span = pkg.spans[0];
    assert.equal(span.locator.kind, "lines");
    const line = pinned.split("\n")[(span.locator as { start: number }).start - 1];
    assert.equal(line, span.exactText);
  });

  it("lets a brief claim and an answer cite the same canonical span", () => {
    const brief = pkg.claims.find((c) => c.type === "signals" && c.sourceVersionId === pkg.sourceVersions[0].id)!;
    const answer = pkg.claims.find((c) => c.type === "answer-sentence")!;
    assert.deepEqual(brief.evidenceSpanIds, answer.evidenceSpanIds);
    assert.deepEqual(pkg.answers[0].citations, answer.evidenceSpanIds);
  });

  it("refuses OCR evidence rendered as plain fact", () => {
    const p = clone();
    p.claims.find((c) => c.id === "claim_invoice_total")!.status = "supported";
    assert.ok(rules(p).includes("weak-evidence"));
  });

  it("refuses a supported claim without evidence, and an unsupported one with it", () => {
    const p = clone();
    p.claims[0].evidenceSpanIds = [];
    p.claims[3].evidenceSpanIds = ["span_invoice_total"];
    const r = rules(p);
    assert.equal(r.filter((x) => x === "provenance").length, 2);
  });

  it("refuses cross-workspace records", () => {
    const p = clone();
    p.claims[1].workspaceId = "ws_other";
    p.sourceVersions[1].workspaceId = "ws_other";
    assert.equal(rules(p).filter((x) => x === "workspace").length, 2);
  });

  it("refuses a citation from an undeclared source version", () => {
    const p = clone();
    p.answers[0].citations.push("span_invoice_total");
    assert.ok(rules(p).includes("citation-version"));
  });

  it("binds the cache key to workspace, corpus, versions, policy and model", () => {
    const a = pkg.answers[0];
    const base = answerCacheKey(a);
    for (const change of [
      { workspaceId: "ws_other" },
      { corpusId: "seed-lab" },
      { sourceVersionIds: ["sv_next"] },
      { policyVersion: "evidence-gate@3" },
      { modelVersion: "gemini-3.7-flash" },
    ]) assert.notEqual(answerCacheKey({ ...a, ...change }), base);
    assert.equal(answerCacheKey({ ...a, sourceVersionIds: [...a.sourceVersionIds].reverse() }), base);
    const p = clone();
    p.answers[0].workspaceId = "ws_fixture";
    p.answers[0].cacheKey = answerCacheKey({ ...a, workspaceId: "ws_other" });
    assert.ok(rules(p).includes("cache-key"));
  });

  it("rejects malformed locators", () => {
    const p = clone();
    p.spans[0].locator = { kind: "lines", start: 9, end: 3 };
    assert.ok(rules(p).includes("locator"));
  });
});

describe("IntelliRAG adapter", () => {
  const version = pkg.sourceVersions[0];

  it("recovers the exact source text from a whitespace-collapsed, truncated snippet", () => {
    const start = pinned.indexOf("##### concurrency");
    const original = pinned.slice(start, start + 120);
    const snippet = `${original.replace(/\s+/g, " ").trim().slice(0, 60)}…`;
    const span = citationToSpan({ chunkId: "c1", textSnippet: snippet }, { version, body: pinned })!;
    assert.ok(span, "span should resolve");
    assert.ok(pinned.includes(span.exactText));
    assert.ok(span.exactText.includes("\n"), "exact text keeps the source's own line breaks");
    assert.equal(span.locator.kind, "lines");
  });

  it("resolves the fixture's citation to the fixture's line", () => {
    const span = citationToSpan({ chunkId: "c", textSnippet: pkg.spans[0].exactText }, { version, body: pinned })!;
    assert.deepEqual(span.locator, pkg.spans[0].locator);
  });

  it("marks an answer sentence unsupported when its citation is not in the source", () => {
    const missing = citationToSpan({ chunkId: "c", textSnippet: "p-queue guarantees exactly-once delivery" }, { version, body: pinned });
    assert.equal(missing, null);
    const claim = answerSentenceClaim({ id: "s1", workspaceId: "ws_fixture", text: "…", version, spans: [missing] });
    assert.equal(claim.status, "unsupported");
    assert.deepEqual(claim.evidenceSpanIds, []);
  });
});
