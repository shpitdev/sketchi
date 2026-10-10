import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const workspaceRoot = new URL("../../", import.meta.url).pathname;
const smoke = await readFile(
  resolve(workspaceRoot, "apps/cli/scripts/smoke.mjs"),
  "utf8",
);
const guard = smoke.slice(
  smoke.indexOf("const requiredNodeVersion ="),
  smoke.indexOf("function assert("),
);
const checkGuard = () => {
  assert.ok(
    guard.startsWith("const requiredNodeVersion ="),
    "smoke must derive its Node requirement",
  );
  // oxlint-disable-next-line typescript/no-implied-eval -- evaluates the guard extracted from the smoke script to prove its behavior
  return new Function(
    "readFileSync",
    "resolve",
    "workspaceRoot",
    "process",
    guard,
  );
};

test("the real smoke guard starts under the exact root Node engine", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(workspaceRoot, "package.json"), "utf8"),
  );
  assert.equal(process.versions.node, manifest.engines.node);
  checkGuard()(readFileSync, resolve, workspaceRoot, process);
});

test("the smoke guard rejects a runtime that differs from the root engine", () => {
  assert.throws(
    () =>
      checkGuard()(readFileSync, resolve, workspaceRoot, {
        versions: { node: "0.0.0" },
      }),
    /CLI smoke requires Node .*; received 0\.0\.0/,
  );
});
