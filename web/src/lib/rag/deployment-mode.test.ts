import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertCustomSourcesAllowed,
  assertVisitorKeysAllowed,
  classifyDeployment,
  DEMO_HEADLINE,
  DemoModeRefusal,
  permittedVisitorKeys,
} from "./deployment-mode.ts";

describe("deployment mode", () => {
  it("classifies a serverless host without Postgres as a seeded-only demo", () => {
    const posture = classifyDeployment({
      storage: { durable: false, backend: "ephemeral" },
      databaseReachable: false,
    });
    assert.equal(posture.mode, "demo");
    assert.deepEqual(posture.reasons, ["ephemeral_storage", "database_unreachable"]);
    assert.equal(posture.customSources, false);
    assert.equal(posture.temporaryImports, false);
    assert.equal(posture.visitorKeys, false);
    assert.equal(posture.headline, DEMO_HEADLINE);
    assert.throws(() => assertCustomSourcesAllowed(posture, "Importing a source"), DemoModeRefusal);
    assert.throws(() => assertVisitorKeysAllowed(posture, "Adding a model key"), DemoModeRefusal);
  });

  it("allows custom sources and visitor keys only in a durable product posture", () => {
    const posture = classifyDeployment({
      storage: { durable: true, backend: "neon" },
      databaseReachable: true,
    });
    assert.equal(posture.mode, "product");
    assert.equal(posture.customSources, true);
    assert.equal(posture.visitorKeys, true);
    assert.equal(posture.temporaryImports, false);
    assert.doesNotThrow(() => assertCustomSourcesAllowed(posture, "Importing a source"));
    assert.doesNotThrow(() => assertVisitorKeysAllowed(posture, "Adding a model key"));
  });

  it("denies visitor mutation and keys on an unreachable durable backend", () => {
    const posture = classifyDeployment({
      storage: { durable: true, backend: "neon" },
      databaseReachable: false,
    });
    assert.equal(posture.mode, "demo");
    assert.deepEqual(posture.reasons, ["database_unreachable"]);
    assert.equal(posture.customSources, false);
    assert.equal(posture.visitorKeys, false);
    assert.equal(posture.temporaryImports, false);
  });

  it("lets an operator force a durable host to remain read-only", () => {
    const posture = classifyDeployment({
      storage: { durable: true, backend: "neon" },
      databaseReachable: true,
      forceDemo: true,
    });
    assert.equal(posture.mode, "demo");
    assert.deepEqual(posture.reasons, ["forced_by_operator"]);
    assert.equal(posture.customSources, false);
    assert.equal(posture.visitorKeys, false);
  });

  it("ignores visitor key cookies retained from an older permissive demo", () => {
    const visitor = { openrouter: "example-visitor-key", gemini: "example-google-key" };
    const demo = classifyDeployment({ storage: { durable: false, backend: "ephemeral" } });
    const product = classifyDeployment({ storage: { durable: true, backend: "neon" } });
    assert.deepEqual(permittedVisitorKeys(demo, visitor), {});
    assert.deepEqual(permittedVisitorKeys(product, visitor), visitor);
  });

  it("returns a predictable refusal type for blocked mutations", () => {
    const demo = classifyDeployment({ storage: { durable: false, backend: "ephemeral" } });
    assert.throws(
      () => assertVisitorKeysAllowed(demo, "Adding a model key"),
      (err: unknown) => err instanceof DemoModeRefusal &&
        err.code === "demo_mode" &&
        err.message.startsWith("Adding a model key is turned off on this public demo"),
    );
  });
});
