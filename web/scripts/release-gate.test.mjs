import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateHealth } from "./release-gate.mjs";

const liveDemo = {
  status: "setup-required",
  databaseReachable: false,
  storage: { backend: "ephemeral", durable: false },
  deployment: {
    mode: "demo",
    reasons: ["ephemeral_storage", "database_unreachable"],
    customSources: false,
    temporaryImports: false,
    visitorKeys: false,
  },
};
const durable = {
  status: "index-ready",
  databaseReachable: true,
  storage: { backend: "neon", durable: true },
  deployment: { mode: "product", reasons: [], customSources: true, temporaryImports: false, visitorKeys: true },
};

describe("release gate", () => {
  it("passes an honestly read-only seeded public demo", () => {
    assert.deepEqual(evaluateHealth(liveDemo, "demo"), []);
  });

  it("blocks a production claim on ephemeral storage", () => {
    const failures = evaluateHealth(liveDemo, "product");
    assert.ok(failures.some((f) => f.startsWith("Expected product mode")));
    assert.ok(failures.includes("Product release requires durable storage."));
  });

  it("blocks demo imports, including ones labeled temporary", () => {
    const lying = { ...liveDemo, deployment: { ...liveDemo.deployment, customSources: true, temporaryImports: true } };
    const failures = evaluateHealth(lying, "demo");
    assert.ok(failures.includes("Demo host advertises visitor source mutations."));
    assert.ok(failures.includes("Demo host advertises temporary visitor imports."));
  });

  it("blocks a demo that accepts visitor model keys even when no import is allowed", () => {
    const lying = { ...liveDemo, deployment: { ...liveDemo.deployment, visitorKeys: true } };
    assert.ok(evaluateHealth(lying, "demo").includes("Demo host advertises visitor model keys."));
  });

  it("rejects an ephemeral server pretending to be a product", () => {
    const lying = { ...liveDemo, deployment: { ...liveDemo.deployment, mode: "product", customSources: true } };
    const failures = evaluateHealth(lying, "demo");
    assert.ok(failures.includes("Server claims product mode without durable, reachable storage."));
    assert.ok(failures.includes("Expected the public host to stay in demo mode."));
  });

  it("rejects a health payload without deployment classification", () => {
    const { deployment: _ignored, ...legacy } = liveDemo;
    assert.equal(evaluateHealth(legacy, "demo").length, 1);
  });

  it("permits a durable, reachable product host", () => {
    assert.deepEqual(evaluateHealth(durable, "product"), []);
  });
});
