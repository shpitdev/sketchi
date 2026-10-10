import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
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
  const cleanup = workflow.jobs["cleanup-preview"];
  const resolvedSha = "${{ needs.resolve-preview-pr.outputs.sha }}";
  const resolvedNumber = "${{ needs.resolve-preview-pr.outputs.pr_number }}";
  assert.equal(deploy.needs, "resolve-preview-pr");
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
  assert.equal(cleanup.needs, "resolve-preview-pr");
  for (const job of [deploy, cleanup]) {
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

test("official Previews never create, deploy, or delete per-PR Workers", () => {
  const deployStep = workflow.jobs["deploy-preview"].steps.find(
    ({ id }) => id === "deploy",
  );
  const deploy = deployStep.run;
  assert.match(deploy, /wrangler preview/);
  assert.match(deploy, /--ignore-base-config/);
  const output = deployStep.env.WRANGLER_OUTPUT_FILE_PATH;
  assert.match(output, /\.ndjson$/);
  assert.match(deploy, /rm -f "\$WRANGLER_OUTPUT_FILE_PATH"/);
  assert.ok(
    workflow.jobs["deploy-preview"].steps
      .find(({ id }) => id === "preview-url")
      .run.includes(output),
    "the URL step reads the output file the deploy step writes",
  );
  assert.doesNotMatch(
    deploy,
    /wrangler (deploy|versions)|--keep-vars|--no-x-provision/,
  );
  assert.match(
    deploy,
    /--config "\$\{\{ steps.worker-app.outputs.worker_config_path \}\}"/,
  );
  assert.match(deploy, /--var "SKETCHI_PLAYGROUND_URL:/);
  assert.match(deploy, /--var "SKETCHI_ICONS_URL:/);

  const cleanupSteps = workflow.jobs["cleanup-preview"].steps;
  const cleanup = cleanupSteps.find(({ id }) => id === "cleanup");
  assert.equal(
    cleanup.run,
    'node scripts/04-delete-preview.mjs --project "$PREVIEW_PROJECT_ID" --pr-number "$PR_NUMBER"',
  );
  const deleteScript = readFileSync(
    new URL("../../04-delete-preview.mjs", import.meta.url),
    "utf8",
  );
  assert.match(deleteScript, /\/workers\/workers\/\$\{project\.workerName\}/);
  assert.doesNotMatch(deleteScript, /workers\/scripts|wrangler/);

  // The comment reports what the script verified, including a failed cleanup.
  const comment = cleanupSteps.find(
    ({ name }) => name === "Comment preview cleanup",
  );
  assert.match(comment.if, /!cancelled\(\)/);
  assert.match(comment.if, /steps\.cleanup\.outputs\.comment_status != ''/);
  assert.equal(
    comment.env.PREVIEW_STATUS,
    "${{ steps.cleanup.outputs.comment_status }}",
  );
});

test("closing a PR deletes its Previews and never deploys", () => {
  assert.ok(workflow.on.pull_request.types.includes("closed"));
  assert.match(
    workflow.jobs["deploy-preview"].if,
    /github\.event\.action != 'closed'/,
  );
  assert.match(
    workflow.jobs["cleanup-preview"].if,
    /github\.event\.action == 'closed'/,
  );
  assert.deepEqual(
    workflow.jobs["cleanup-preview"].strategy.matrix.project,
    workflow.jobs["deploy-preview"].strategy.matrix.project,
  );
  assert.deepEqual(
    workflow.jobs["cleanup-preview"].concurrency,
    workflow.jobs["deploy-preview"].concurrency,
  );
});

// Run the re-check step with a stub `gh` that reports the given PR state.
function recheckPrState(state) {
  const step = workflow.jobs["deploy-preview"].steps.find(
    ({ id }) => id === "still-open",
  );
  const dir = mkdtempSync(path.join(tmpdir(), "preview-recheck-"));
  try {
    const gh = path.join(dir, "gh");
    writeFileSync(
      gh,
      `#!/usr/bin/env bash\necho "$*" > "${dir}/gh-args"\necho ${state}\n`,
    );
    chmodSync(gh, 0o755);
    const output = path.join(dir, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", ["-c", step.run], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_REPOSITORY: "shpitdev/sketchi",
        PATH: `${dir}:${process.env.PATH}`,
        PR_NUMBER: "42",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return {
      args: readFileSync(path.join(dir, "gh-args"), "utf8").trim(),
      output: readFileSync(output, "utf8"),
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

test("deploys re-check the PR state after taking the lock and skip closed PRs", () => {
  const steps = workflow.jobs["deploy-preview"].steps;
  const recheck = steps.findIndex(({ id }) => id === "still-open");
  const build = steps.findIndex(({ run }) => run?.includes("pnpm nx build"));
  assert.ok(recheck > build, "re-check after the build, not before");
  assert.equal(steps[recheck + 1].id, "deploy");
  for (const step of steps.filter(
    ({ id, name }) =>
      ["deploy", "preview-url"].includes(id) || name === "Comment preview URL",
  )) {
    assert.match(step.if, /steps\.still-open\.outputs\.open == 'true'/);
  }

  const open = recheckPrState("open");
  assert.equal(open.args, "api repos/shpitdev/sketchi/pulls/42 --jq .state");
  assert.equal(open.output, "open=true\n");
  assert.equal(recheckPrState("closed").output, "open=false\n");
});
