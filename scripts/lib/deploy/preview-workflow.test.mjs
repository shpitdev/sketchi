import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.resolve("nx/package.json"));
const workflow = require("@zkochan/js-yaml").load(
  readFileSync(
    new URL("../../../.github/workflows/app-preview.yml", import.meta.url),
    "utf8",
  ),
);
const sha = "a".repeat(40);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function resolvePr({
  state = "open",
  repository = "shpitdev/sketchi",
  action = "deploy",
  prNumber = "42",
  eventSha = "",
  ok = true,
} = {}) {
  const resolver = workflow.jobs["resolve-preview-pr"];
  assert.ok(resolver, "manual dispatch must resolve the PR before checkout");
  const step = resolver.steps.find(({ id }) => id === "pr");
  const script = step.run.match(
    /node --input-type=module <<'NODE'\n([\s\S]+?)\nNODE/,
  )[1];
  const outputs = [];
  const requests = [];
  await new AsyncFunction(
    "process",
    "fetch",
    "appendFileSync",
    script.replace(/^import .*;\n/gm, ""),
  )(
    {
      env: {
        PR_NUMBER: prNumber,
        PREVIEW_ACTION: action,
        EVENT_HEAD_SHA: eventSha,
        GITHUB_REPOSITORY: "shpitdev/sketchi",
        GITHUB_API_URL: "https://api.github.com",
        GITHUB_TOKEN: "offline-test-token",
        GITHUB_OUTPUT: "offline-output",
      },
    },
    async (url) => {
      requests.push(url);
      return Response.json(
        { number: 42, state, head: { sha, repo: { full_name: repository } } },
        { status: ok ? 200 : 404 },
      );
    },
    (file, text) => {
      assert.equal(file, "offline-output");
      outputs.push(text);
    },
  );
  return { outputs: outputs.join(""), requests };
}

test("manual preview resolution returns the PR head rather than the dispatch ref", async () => {
  const resolved = await resolvePr();
  assert.equal(resolved.outputs, `pr_number=42\nsha=${sha}\n`);
  assert.deepEqual(resolved.requests, [
    "https://api.github.com/repos/shpitdev/sketchi/pulls/42",
  ]);
});

test("preview resolver rejects forks and closed deploys but permits closed cleanup", async () => {
  await assert.rejects(
    resolvePr({ repository: "fork/sketchi" }),
    /same.repository/,
  );
  await assert.rejects(resolvePr({ state: "closed" }), /open PR/);
  assert.match(
    (await resolvePr({ state: "closed", action: "cleanup" })).outputs,
    /pr_number=42/,
  );
});

test("preview resolver rejects malformed numbers and failed PR lookups", async () => {
  for (const prNumber of ["42oops", "42.9", "4e2", "9007199254740993"]) {
    await assert.rejects(resolvePr({ prNumber }), /positive.*integer/);
  }
  await assert.rejects(resolvePr({ ok: false }), /HTTP 404/);
});

test("pull request events retain their immutable event head SHA", async () => {
  const eventSha = "b".repeat(40);
  assert.match(
    (await resolvePr({ eventSha })).outputs,
    new RegExp(`sha=${eventSha}`),
  );
});

test("deploy checkout, metadata, and comments share the resolved PR SHA", () => {
  const deploy = workflow.jobs["deploy-preview"];
  const resolvedSha = "${{ needs.resolve-preview-pr.outputs.sha }}";
  const resolvedNumber = "${{ needs.resolve-preview-pr.outputs.pr_number }}";
  assert.equal(deploy.needs, "resolve-preview-pr");
  assert.equal(workflow.jobs["cleanup-preview"].needs, "resolve-preview-pr");
  assert.equal(
    deploy.steps.find(({ uses }) => uses?.startsWith("actions/checkout@")).with
      .ref,
    resolvedSha,
  );
  for (const step of deploy.steps.filter(({ name }) =>
    name?.startsWith("Comment"),
  )) {
    assert.equal(step.env.PREVIEW_SHA, resolvedSha);
    assert.equal(step.env.PR_NUMBER, resolvedNumber);
  }
  assert.ok(
    deploy.steps.find(({ id }) => id === "deploy").run.includes(resolvedSha),
  );
  for (const job of [deploy, workflow.jobs["cleanup-preview"]]) {
    assert.equal(
      job.steps.find(({ uses }) => uses?.startsWith("actions/checkout@")).with
        .ref,
      resolvedSha,
    );
    for (const step of job.steps.filter(({ env }) => env?.PR_NUMBER)) {
      assert.equal(step.env.PR_NUMBER, resolvedNumber);
    }
  }
});
