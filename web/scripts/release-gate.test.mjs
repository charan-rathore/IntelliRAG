import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateHealth } from "./release-gate.mjs";

const liveDemo = {
  status: "setup-required",
  databaseReachable: false,
  storage: { backend: "ephemeral", durable: false },
  deployment: { mode: "demo", reasons: ["ephemeral_storage", "database_unreachable"], customSources: true, temporaryImports: true },
};
const durable = {
  status: "index-ready",
  databaseReachable: true,
  storage: { backend: "neon", durable: true },
  deployment: { mode: "product", reasons: [], customSources: true },
};

describe("release gate", () => {
  it("passes the current public host as an honest demo", () => {
    assert.deepEqual(evaluateHealth(liveDemo, "demo"), []);
  });

  it("blocks a product release from ephemeral storage", () => {
    const failures = evaluateHealth(liveDemo, "product");
    assert.ok(failures.some((f) => f.startsWith("Expected product mode")));
    assert.ok(failures.includes("Product release requires durable storage."));
  });

  it("blocks a host that accepts sources it will lose", () => {
    const lying = { ...liveDemo, deployment: { ...liveDemo.deployment, mode: "product", customSources: true, temporaryImports: false } };
    const failures = evaluateHealth(lying, "demo");
    assert.ok(failures.includes("Server claims product mode without durable, reachable storage."));
    assert.ok(failures.includes("Custom sources are accepted on non-durable storage without saying imports are temporary."));
  });

  it("blocks a health payload that predates deployment modes", () => {
    const { deployment: _ignored, ...legacy } = liveDemo;
    assert.equal(evaluateHealth(legacy, "demo").length, 1);
  });

  it("passes a durable product host", () => {
    assert.deepEqual(evaluateHealth(durable, "product"), []);
  });
});
