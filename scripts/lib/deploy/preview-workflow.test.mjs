import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { workerProjectIds } from "../worker-apps.mjs";
import { previewProjectConfig } from "./preview.mjs";

const require = createRequire(import.meta.resolve("nx/package.json"));
const workflow = require("@zkochan/js-yaml").load(
	readFileSync(new URL("../../../.github/workflows/app-preview.yml", import.meta.url), "utf8"),
);
const sha = "a".repeat(40);
const baseSha = "c".repeat(40);
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
	const script = step.run.match(/node --input-type=module <<'NODE'\n([\s\S]+?)\nNODE/)[1];
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
				{
					number: 42,
					state,
					base: { sha: baseSha },
					head: { sha, repo: { full_name: repository } },
				},
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
	assert.equal(resolved.outputs, `pr_number=42\nsha=${sha}\nbase_sha=${baseSha}\n`);
	assert.deepEqual(resolved.requests, ["https://api.github.com/repos/shpitdev/sketchi/pulls/42"]);
});

test("preview resolver rejects forks and closed deploys but permits closed cleanup", async () => {
	await assert.rejects(resolvePr({ repository: "fork/sketchi" }), /same.repository/);
	await assert.rejects(resolvePr({ state: "closed" }), /open PR/);
	assert.match((await resolvePr({ state: "closed", action: "cleanup" })).outputs, /pr_number=42/);
});

test("preview resolver rejects malformed numbers and failed PR lookups", async () => {
	for (const prNumber of ["42oops", "42.9", "4e2", "9007199254740993"]) {
		await assert.rejects(resolvePr({ prNumber }), /positive.*integer/);
	}
	await assert.rejects(resolvePr({ ok: false }), /HTTP 404/);
});

test("pull request events retain their immutable event head SHA", async () => {
	const eventSha = "b".repeat(40);
	assert.match((await resolvePr({ eventSha })).outputs, new RegExp(`sha=${eventSha}`));
});

test("deploy checkout, metadata, and comments share the resolved PR SHA", () => {
	const deploy = workflow.jobs["deploy-preview"];
	const cleanup = workflow.jobs["cleanup-preview"];
	const resolvedSha = "${{ needs.resolve-preview-pr.outputs.sha }}";
	const resolvedNumber = "${{ needs.resolve-preview-pr.outputs.pr_number }}";
	assert.equal(deploy.needs, "resolve-preview-pr");
	assert.equal(
		deploy.steps.find(({ uses }) => uses?.startsWith("actions/checkout@")).with.ref,
		resolvedSha,
	);
	for (const step of deploy.steps.filter(({ name }) => name?.startsWith("Comment"))) {
		assert.equal(step.env.PREVIEW_SHA, resolvedSha);
		assert.equal(step.env.PR_NUMBER, resolvedNumber);
	}
	assert.ok(deploy.steps.find(({ id }) => id === "deploy").run.includes(resolvedSha));
	assert.equal(cleanup.needs, "resolve-preview-pr");
	for (const job of [deploy, cleanup]) {
		assert.equal(
			job.steps.find(({ uses }) => uses?.startsWith("actions/checkout@")).with.ref,
			resolvedSha,
		);
		for (const step of job.steps.filter(({ env }) => env?.PR_NUMBER)) {
			assert.equal(step.env.PR_NUMBER, resolvedNumber);
		}
	}
});

test("official Previews never create, deploy, or delete per-PR Workers", () => {
	const deployStep = workflow.jobs["deploy-preview"].steps.find(({ id }) => id === "deploy");
	const deploy = deployStep.run;
	assert.match(deploy, /wrangler preview/);
	assert.match(deploy, /--ignore-base-config/);
	const output = deployStep.env.WRANGLER_OUTPUT_FILE_PATH;
	assert.match(output, /\.ndjson$/);
	// The retry wrapper clears the output file before every attempt.
	assert.match(deploy, /node scripts\/07-wrangler-retry\.mjs -- pnpm exec wrangler preview/);
	assert.ok(
		workflow.jobs["deploy-preview"].steps
			.find(({ id }) => id === "preview-url")
			.run.includes(output),
		"the URL step reads the output file the deploy step writes",
	);
	assert.doesNotMatch(deploy, /wrangler (deploy|versions)|--keep-vars|--no-x-provision/);
	assert.match(deploy, /--config "\$\{\{ steps.worker-app.outputs.worker_config_path \}\}"/);
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
	const comment = cleanupSteps.find(({ name }) => name === "Comment preview cleanup");
	assert.match(comment.if, /!cancelled\(\)/);
	assert.match(comment.if, /steps\.cleanup\.outputs\.comment_status != ''/);
	assert.equal(comment.env.PREVIEW_STATUS, "${{ steps.cleanup.outputs.comment_status }}");
});

test("closing a PR deletes its Previews and never deploys", () => {
	assert.ok(workflow.on.pull_request.types.includes("closed"));
	assert.match(workflow.jobs["deploy-preview"].if, /github\.event\.action != 'closed'/);
	assert.match(workflow.jobs["cleanup-preview"].if, /github\.event\.action == 'closed'/);
	// Every app, whichever ones this PR previewed.
	assert.deepEqual(
		workflow.jobs["cleanup-preview"].strategy.matrix.project.toSorted(),
		workerProjectIds.toSorted(),
	);
	assert.equal(
		workflow.jobs["deploy-preview"].strategy.matrix.project,
		"${{ fromJSON(needs.resolve-preview-pr.outputs.projects) }}",
	);
	assert.deepEqual(
		workflow.jobs["cleanup-preview"].concurrency,
		workflow.jobs["deploy-preview"].concurrency,
	);
});

// Run the re-check step with a stub `gh` that reports the given PR state.
function recheckPrState(state) {
	const step = workflow.jobs["deploy-preview"].steps.find(({ id }) => id === "still-open");
	const dir = mkdtempSync(path.join(tmpdir(), "preview-recheck-"));
	try {
		const gh = path.join(dir, "gh");
		writeFileSync(gh, `#!/usr/bin/env bash\necho "$*" > "${dir}/gh-args"\necho ${state}\n`);
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
		({ id, name }) => ["deploy", "preview-url"].includes(id) || name === "Comment preview URL",
	)) {
		assert.match(step.if, /steps\.still-open\.outputs\.open == 'true'/);
	}

	const open = recheckPrState("open");
	assert.equal(open.args, "api repos/shpitdev/sketchi/pulls/42 --jq .state");
	assert.equal(open.output, "open=true\n");
	assert.equal(recheckPrState("closed").output, "open=false\n");
});

// Evaluate the resolver's `if` for a pull_request event the way GitHub Actions would.
function resolverRuns({ action, labels = [], label, repository = "shpitdev/sketchi" }) {
	const expression = workflow.jobs["resolve-preview-pr"].if
		.replaceAll("github.event_name", "event.name")
		.replaceAll("github.event.pull_request.head.repo.full_name", "event.repository")
		.replaceAll("github.repository", '"shpitdev/sketchi"')
		.replaceAll("github.event.action", "event.action")
		.replaceAll("github.event.label.name", "event.label")
		.replaceAll(
			"contains(github.event.pull_request.labels.*.name, 'preview')",
			"event.labels.includes('preview')",
		)
		.replaceAll(/\s+/g, " ");
	// oxlint-disable-next-line typescript/no-implied-eval -- evaluates the workflow expression the way GitHub Actions would
	return new Function("event", `return (${expression});`)({
		name: "pull_request",
		action,
		labels,
		label,
		repository,
	});
}

test("only a PR labelled preview deploys; every same-repository close cleans up", () => {
	assert.equal(resolverRuns({ action: "synchronize" }), false);
	assert.equal(resolverRuns({ action: "opened" }), false);
	assert.equal(resolverRuns({ action: "synchronize", labels: ["preview"] }), true);
	assert.equal(resolverRuns({ action: "labeled", labels: ["preview"], label: "preview" }), true);
	assert.equal(
		resolverRuns({ action: "labeled", labels: ["preview", "bug"], label: "bug" }),
		false,
		"adding another label must not redeploy",
	);
	assert.equal(resolverRuns({ action: "closed" }), true);
	assert.equal(resolverRuns({ action: "closed", repository: "fork/sketchi" }), false);
	assert.equal(
		resolverRuns({ action: "synchronize", labels: ["preview"], repository: "fork/sketchi" }),
		false,
	);
	assert.ok(workflow.on.pull_request.types.includes("labeled"));
});

test("previews select their apps after the PR resolves, and deploy only those", () => {
	const steps = workflow.jobs["resolve-preview-pr"].steps;
	const select = steps.find(({ id }) => id === "projects");
	assert.equal(select.run, "node scripts/08-select-preview-projects.mjs");
	assert.equal(select.env.PREVIEW_SELECTION, "${{ inputs.project || 'affected' }}");
	assert.equal(select.env.HEAD_SHA, "${{ steps.pr.outputs.sha }}");
	assert.ok(steps.findIndex(({ id }) => id === "pr") < steps.indexOf(select));
	assert.deepEqual(workflow.on.workflow_dispatch.inputs.project.options, [
		"affected",
		"all",
		...workflow.jobs["cleanup-preview"].strategy.matrix.project,
	]);
	assert.match(workflow.jobs["deploy-preview"].if, /outputs\.projects != '\[\]'/);
	assert.doesNotMatch(
		JSON.stringify(workflow.jobs["deploy-preview"].steps),
		/test:deploy-scripts/,
		"pnpm ci:local proves the deploy scripts",
	);
});

// Run the close-time Preview detection with a stub `gh` that serves the given comment pages.
function detectExistingPreview({ label = false, pages = [] } = {}) {
	const step = workflow.jobs["resolve-preview-pr"].steps.find(({ id }) => id === "existing");
	const dir = mkdtempSync(path.join(tmpdir(), "preview-existing-"));
	try {
		const gh = path.join(dir, "gh");
		writeFileSync(path.join(dir, "pages.json"), JSON.stringify(pages));
		writeFileSync(
			gh,
			`#!/usr/bin/env bash\necho "$*" >> "${dir}/gh-args"\ncat "${dir}/pages.json"\n`,
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
				HAS_PREVIEW_LABEL: String(label),
				PATH: `${dir}:${process.env.PATH}`,
				PR_NUMBER: "42",
				RUNNER_TEMP: dir,
			},
		});
		assert.equal(result.status, 0, result.stderr);
		let args = "";
		try {
			args = readFileSync(path.join(dir, "gh-args"), "utf8").trim();
		} catch {}
		return { args, output: readFileSync(output, "utf8") };
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
}

const bot = { login: "github-actions[bot]" };

test("a closed PR cleans up only when a Preview can exist", () => {
	const step = workflow.jobs["resolve-preview-pr"].steps.find(({ id }) => id === "existing");
	assert.equal(step.if, "github.event.action == 'closed'");
	assert.match(
		workflow.jobs["cleanup-preview"].if,
		/needs\.resolve-preview-pr\.outputs\.cleanup == 'true'/,
	);

	// The label alone is enough, without reading comments.
	assert.deepEqual(detectExistingPreview({ label: true }), { args: "", output: "cleanup=true\n" });

	// A sticky comment from any app, on any page, counts, including Previews from before opt-in.
	for (const project of workerProjectIds) {
		const marker = previewProjectConfig(project).commentMarker;
		const found = detectExistingPreview({
			pages: [
				[{ user: { login: "someone" }, body: "lgtm" }],
				[{ user: bot, body: `${marker}\nready` }],
			],
		});
		assert.equal(found.output, "cleanup=true\n", project);
		assert.equal(found.args, "api --paginate --slurp repos/shpitdev/sketchi/issues/42/comments");
	}

	// No label and no bot-owned Preview comment: nothing to clean up.
	assert.equal(detectExistingPreview({ pages: [[]] }).output, "cleanup=false\n");
	assert.equal(
		detectExistingPreview({
			pages: [[{ user: { login: "someone" }, body: "<!-- sketchi-web-preview --> quoted" }]],
		}).output,
		"cleanup=false\n",
	);
});

test("a dispatched Preview labels its PR before anything uploads", () => {
	const resolver = workflow.jobs["resolve-preview-pr"].steps;
	const label = resolver.findIndex(({ name }) => name === "Label the PR for cleanup");
	assert.ok(label > resolver.findIndex(({ id }) => id === "pr"));
	assert.ok(label < resolver.findIndex(({ uses }) => uses?.startsWith("actions/checkout")));
	assert.equal(resolver[label].if, "github.event_name == 'workflow_dispatch'");
	assert.equal(resolver[label].env.PR_NUMBER, "${{ steps.pr.outputs.pr_number }}");
	assert.match(
		resolver[label].run,
		/gh api --method POST "repos\/\$\{GITHUB_REPOSITORY\}\/issues\/\$\{PR_NUMBER\}\/labels" -f "labels\[\]=preview"/,
	);
	assert.ok(
		workflow.permissions["pull-requests"] === "write" || workflow.permissions.issues === "write",
	);

	// The deploy re-checks the PR after the label, so a close before the label skips the upload.
	const deploy = workflow.jobs["deploy-preview"].steps;
	assert.ok(
		deploy.findIndex(({ id }) => id === "still-open") <
			deploy.findIndex(({ id }) => id === "deploy"),
	);
	assert.match(deploy.find(({ id }) => id === "deploy").if, /still-open\.outputs\.open == 'true'/);
});
