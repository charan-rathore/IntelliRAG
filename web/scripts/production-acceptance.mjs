import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
const base = process.argv[2] || "https://intellirag-live-own-track.vercel.app";
const destination = process.argv[3] || "../audit/production-acceptance.json";
const fixture = JSON.parse(
  await readFile(new URL("../../audit/golden.json", import.meta.url), "utf8"),
);
const report = {
  runId: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  base,
  datasetHash: createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
  status: "blocked",
  health: null,
  samples: [],
  failures: [],
  coldStart: "not proven: compare a second run after redeploy using a different instanceId",
};
try {
  const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(12000) });
  report.health = await response.json();
  if (
    !report.health.databaseReachable ||
    report.health.status !== "index-ready" ||
    !report.health.storage?.durable
  )
    report.failures.push(
      "A reachable persistent database and complete current-model embeddings are required.",
    );
  if (!report.health.hasGeminiKey && !report.health.hasOpenRouterKey)
    report.failures.push("A real generation/embedding provider must be configured.");
  if (!report.failures.length) {
    report.status = "fail";
    for (const sample of fixture.gold) {
      const response = await fetch(base + "/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: sample.question,
          corpus: "seed-lab",
          retrievalMode: "hybrid",
          skipCache: true,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const raw = await response.text();
      const events = raw
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.slice(6)));
      const done = events.find((e) => e.type === "done");
      const passed = Boolean(
        done &&
        done.actualMode === "hybrid" &&
        done.embeddingModel === "gemini-embedding-2" &&
        Boolean(done.model) &&
        !["extractive", "graphify-cache"].includes(done.model) &&
        !done.cacheHit &&
        done.citations?.some((c) =>
          done.candidates?.some(
            (candidate) =>
              candidate.documentId === c.documentId && candidate.slug === sample.documentId,
          ),
        ),
      );
      report.samples.push({
        sampleId: sample.sampleId,
        question: sample.question,
        passed,
        done,
        errors: events.filter((e) => e.type === "error"),
      });
    }
    if (report.samples.every((s) => s.passed)) report.status = "pass";
    else report.failures.push("One or more frozen retrieval/generation acceptance cases failed.");
  }
} catch (error) {
  report.failures.push(error.message);
}
if (process.argv[4]) {
  const previous = JSON.parse(await readFile(process.argv[4], "utf8"));
  const sameIndex = Boolean(
    report.health?.indexFingerprint &&
    report.health.indexFingerprint === previous.health?.indexFingerprint,
  );
  const newInstance = Boolean(
    report.health?.instanceId && report.health.instanceId !== previous.health?.instanceId,
  );
  report.coldStart = {
    sameIndex,
    newInstance,
    passed: report.status === "pass" && previous.status === "pass" && sameIndex && newInstance,
  };
  if (!report.coldStart.passed) {
    report.failures.push(
      "Cold-start comparison did not prove a changed worker with an unchanged persistent index and passing retrieval.",
    );
    if (report.status === "pass") report.status = "fail";
  }
}
await mkdir(dirname(resolve(destination)), { recursive: true });
await writeFile(destination, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      status: report.status,
      samples: report.samples.length,
      failures: report.failures,
      report: destination,
    },
    null,
    2,
  ),
);
process.exitCode = report.status === "pass" ? 0 : 2;
