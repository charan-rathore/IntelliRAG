import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { checkedOutputPath, checkedUrl } from "./browser-guard.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const guardUrl = pathToFileURL(join(scriptDir, "browser-guard.mjs")).href;

function runGuard(source, extraEnv = {}) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    env: { ...process.env, BROWSER_ALLOW_EXTERNAL_HOST: "", ...extraEnv },
  });
}

function expectGuardFailure(result, expectedMessage) {
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr);
  assert.equal(error.ok, false);
  assert.match(error.error, expectedMessage);
}

test("checkedUrl accepts only HTTP and HTTPS URLs", () => {
  assert.equal(checkedUrl("http://localhost:8080/"), "http://localhost:8080/");
  assert.equal(checkedUrl("https://[::1]/preview"), "https://[::1]/preview");

  const result = runGuard(
    `import { checkedUrl } from ${JSON.stringify(guardUrl)}; checkedUrl("file:///tmp/private");`,
    { BROWSER_ALLOW_EXTERNAL_HOST: "1" },
  );
  expectGuardFailure(result, /only http\/https URLs are allowed/);
});

test("checkedUrl blocks external hosts unless explicitly allowed", () => {
  const source = `import { checkedUrl } from ${JSON.stringify(guardUrl)}; checkedUrl("https://example.com/");`;
  expectGuardFailure(runGuard(source), /not a loopback host/);
  assert.equal(runGuard(source, { BROWSER_ALLOW_EXTERNAL_HOST: "1" }).status, 0);
});

test("checkedOutputPath accepts only strict children of allowed directories", () => {
  assert.equal(
    checkedOutputPath("/workspace/captures/preview.png", ["/workspace"]),
    "/workspace/captures/preview.png",
  );

  const source = `import { checkedOutputPath } from ${JSON.stringify(guardUrl)}; checkedOutputPath("/workspace/../private.png", ["/workspace"], "capture");`;
  expectGuardFailure(runGuard(source), /capture path must be under/);
  const directory = `import { checkedOutputPath } from ${JSON.stringify(guardUrl)}; checkedOutputPath("/workspace", ["/workspace"]);`;
  expectGuardFailure(runGuard(directory), /screenshot path must be under/);
});
