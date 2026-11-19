import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addCase, caseEvidence, consolidateCases, emptyCaseMemory, rerankWithCases } from "./case-memory.ts";
import { DefinitionIndex, devEntities } from "./dev-entities.ts";

describe("reading the code a question names", () => {
  it("pulls traceback paths, dotted modules and identifiers", () => {
    const e = devEntities('Traceback:\n  File "/usr/lib/python3/site-packages/sklearn/linear_model/ridge.py", line 10\n`RidgeClassifierCV(store_cv_values=True)` raises TypeError in sklearn.linear_model.RidgeClassifierCV');
    assert.ok(e.paths.includes("sklearn/linear_model/ridge.py"));
    assert.ok(e.modules.includes("sklearn.linear_model.RidgeClassifierCV"));
    assert.ok(e.symbols.includes("RidgeClassifierCV") && e.symbols.includes("store_cv_values"));
    assert.ok(!e.symbols.includes("print"));
  });

  it("links them to the files that define them, rare names counting more", () => {
    const defs = new DefinitionIndex([
      { path: "sklearn/linear_model/ridge.py", text: "class RidgeClassifierCV(Base):\n    pass" },
      { path: "sklearn/base.py", text: "def clone(x):\n    return x\nclass Base: pass" },
      { path: "sklearn/utils.py", text: "def helper(): pass" },
    ]);
    const link = defs.link(devEntities("RidgeClassifierCV fails; see sklearn/linear_model/ridge.py"));
    assert.ok((link.get("sklearn/linear_model/ridge.py") ?? 0) > 3);
    assert.equal(link.get("sklearn/utils.py"), undefined);
  });
});

describe("case memory", () => {
  const cases = [
    { q: "admin changelist filter crashes on null foreign key", files: ["admin/filters.py"] },
    { q: "migration autodetector renames field twice", files: ["migrations/autodetector.py"] },
    { q: "admin list filter with null related field crashes", files: ["admin/filters.py"] },
  ].reduce((s, c) => addCase(s, c), emptyCaseMemory());

  it("borrows the files of similar resolved questions", () => {
    const ev = caseEvidence(cases.cases, "list_filter crashes when the foreign key is null in admin");
    const top = [...ev.similar].sort((a, b) => b[1] - a[1])[0]![0];
    assert.equal(top, "admin/filters.py");
    assert.deepEqual(rerankWithCases(["views.py", "admin/filters.py"], ev, { similar: 1, prior: 0 })[0], "admin/filters.py");
  });

  it("sleep adopts weights only when replaying history says they help, and journals why", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ q: `admin filter null crash case ${i}`, files: ["admin/filters.py"] })).reduce((s, c) => addCase(s, c), emptyCaseMemory());
    const helped = consolidateCases(many, () => ["views.py", "urls.py", "admin/filters.py"], { at: 1 });
    assert.equal(helped.journal.at(-1)!.accepted, true);
    assert.ok(helped.weights.similar > 0 || helped.weights.prior > 0);
    const already = consolidateCases(many, () => ["admin/filters.py", "views.py"], { at: 2 });
    assert.equal(already.journal.at(-1)!.accepted, false);
    assert.deepEqual(already.weights, { similar: 0, prior: 0 });
    assert.match(already.journal.at(-1)!.rationale, /kept them/);
  });
});
