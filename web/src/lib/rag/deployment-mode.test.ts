import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertCustomSourcesAllowed,
  assertVisitorKeysAllowed,
  classifyDeployment,
  DEMO_HEADLINE,
  DemoModeRefusal,
} from "./deployment-mode.ts";

describe("deployment mode", () => {
  it("treats the live serverless host without Postgres as a demo", () => {
    const posture = classifyDeployment({
      storage: { durable: false, backend: "ephemeral" },
      databaseReachable: false,
    });
    assert.equal(posture.mode, "demo");
    assert.deepEqual(posture.reasons, ["ephemeral_storage", "database_unreachable"]);
    assert.equal(posture.customSources, true, "imports keep working on a temporary host");
    assert.equal(posture.temporaryImports, true);
    assert.equal(posture.visitorKeys, false);
    assert.equal(posture.headline, DEMO_HEADLINE);
  });

  it("allows custom sources only with durable, reachable storage", () => {
    const posture = classifyDeployment({ storage: { durable: true, backend: "neon" }, databaseReachable: true });
    assert.equal(posture.mode, "product");
    assert.equal(posture.customSources, true);
    assert.doesNotThrow(() => assertCustomSourcesAllowed(posture, "Importing a source"));
  });

  it("falls back to demo when a durable backend is unreachable", () => {
    const posture = classifyDeployment({ storage: { durable: true, backend: "neon" }, databaseReachable: false });
    assert.equal(posture.mode, "demo");
    assert.deepEqual(posture.reasons, ["database_unreachable"]);
  });

  it("lets an operator force a durable host into demo posture", () => {
    const posture = classifyDeployment({ storage: { durable: true, backend: "neon" }, forceDemo: true });
    assert.equal(posture.mode, "demo");
    assert.deepEqual(posture.reasons, ["forced_by_operator"]);
  });

  it("refuses a visitor key on a demo host with a visitor-readable reason", () => {
    const posture = classifyDeployment({ storage: { durable: false, backend: "ephemeral" } });
    assert.doesNotThrow(() => assertCustomSourcesAllowed(posture, "Importing a source"));
    assert.throws(
      () => assertVisitorKeysAllowed(posture, "Importing a source"),
      (err: unknown) =>
        err instanceof DemoModeRefusal &&
        err.code === "demo_mode" &&
        err.message.startsWith("Importing a source is turned off on this public demo"),
    );
  });
});
