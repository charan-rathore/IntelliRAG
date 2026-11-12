import { test } from "node:test";
import assert from "node:assert/strict";
import { singleFlight } from "../src/lib/rag/graphify/single-flight.mjs";

test("concurrent graph readers share one refresh but later readers check freshness again", async () => {
  const state = {}; let calls = 0, release;
  const load = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const readers = Array.from({ length: 20 }, () => singleFlight(state, load));
  await Promise.resolve();
  assert.equal(calls, 1); release({ version: 1 });
  assert.equal((await Promise.all(readers)).length, 20);
  assert.deepEqual(await singleFlight(state, async () => ({ version: 2 })), { version: 2 });
});
test("a failed refresh is shared and never poisons later retries", async () => {
  const state = {}; let calls = 0;
  const fail = async () => { calls++; throw new Error("database unavailable"); };
  const results = await Promise.allSettled([singleFlight(state, fail), singleFlight(state, fail)]);
  assert.equal(calls, 1); assert.ok(results.every(result => result.status === "rejected"));
  assert.equal(await singleFlight(state, async () => "recovered"), "recovered");
});
