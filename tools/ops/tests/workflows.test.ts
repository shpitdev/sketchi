// Scripts the workflows run inline, executed the way GitHub Actions runs them: the release
// guard and publish step with `git` and `npm` stubs, and the preview PR resolver with a fixture
// GitHub API. They run before any checkout or install, so they cannot be ops commands.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { executable, repoRoot, scratch } from "./harness";

const yaml = createRequire(createRequire(import.meta.url).resolve("nx/package.json"))(
	"@zkochan/js-yaml",
) as { load: (text: string) => unknown };
interface Step {
	readonly id?: string;
	readonly run?: string;
}
interface Workflow {
	readonly jobs: Record<string, { readonly steps: Step[] }>;
}
const workflow = (name: string) =>
	yaml.load(readFileSync(join(repoRoot, ".github/workflows", name), "utf8")) as Workflow;
const stepRun = (steps: Step[], match: (step: Step) => boolean) => steps.find(match)?.run ?? "";

const release = workflow("release.yml").jobs;
const guardScript = stepRun(release["guard"]?.steps ?? [], (step) => step.id === "check");
const publishScript = stepRun(release["publish"]?.steps ?? [], (step) =>
	Boolean(step.run?.includes("npm publish")),
);
const cliManifest = readFileSync(join(repoRoot, "apps/cli/package.json"), "utf8");
const version: string = JSON.parse(cliManifest).version;

interface Reply {
	readonly stdout?: string;
	readonly stderr?: string;
	readonly status?: number;
}

/** Runs a release step from a scratch checkout holding only the CLI manifest. */
function runStep(script: string, stubs: { git?: Reply; npmView?: Reply; npmPublish?: Reply } = {}) {
	const directory = scratch("ops-release-");
	const checkout = join(directory, "checkout");
	mkdirSync(join(checkout, "apps", "cli"), { recursive: true });
	writeFileSync(join(checkout, "apps", "cli", "package.json"), cliManifest);
	const reply = ({ stdout = "", stderr = "", status = 0 }: Reply) =>
		`printf '%s' ${JSON.stringify(stdout)}; printf '%s' ${JSON.stringify(stderr)} >&2; exit ${status}`;
	const stub = (name: string, body: string) => {
		writeFileSync(join(directory, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
	};
	stub("git", `[ "$1" = ls-remote ] && { ${reply(stubs.git ?? {})}; }; exit 64`);
	stub(
		"npm",
		[
			`[ "$1" = view ] && { ${reply(stubs.npmView ?? {})}; }`,
			`[ "$1" = publish ] && { ${reply(stubs.npmPublish ?? {})}; }`,
			"exit 64",
		].join("\n"),
	);
	const githubOutput = join(directory, "github-output");
	writeFileSync(githubOutput, "");
	const result = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
		cwd: checkout,
		encoding: "utf8",
		env: {
			...process.env,
			GITHUB_OUTPUT: githubOutput,
			PATH: `${directory}:${process.env["PATH"]}`,
			RUNNER_TEMP: directory,
			VERSION: version,
		},
	});
	const outputs = Object.fromEntries(
		readFileSync(githubOutput, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split("=")),
	);
	return { outputs, output: result.stdout + result.stderr, status: result.status };
}

const missingVersion = { stderr: "npm error code E404", status: 1 };

describe("release guard", () => {
	test("publishes only an untagged version npm does not serve", () => {
		expect(runStep(guardScript, { npmView: missingVersion }).outputs).toEqual({
			publish: "true",
			version,
		});
		for (const stubs of [
			// The tag exists while npm still stages the version.
			{ git: { stdout: `abc123\trefs/tags/cli-v${version}\n` }, npmView: missingVersion },
			{ npmView: { stdout: version } },
		]) {
			const result = runStep(guardScript, stubs);
			expect(result.status, result.output).toBe(0);
			expect(result.outputs).toEqual({ publish: "false", version });
		}
	});

	test("fails closed when the tag or registry lookup fails", () => {
		for (const stubs of [
			{ git: { stderr: "fatal: unable to access", status: 128 } },
			{ npmView: { stderr: "npm error code ECONNRESET", status: 1 } },
		]) {
			const result = runStep(guardScript, stubs);
			expect(result.status).not.toBe(0);
			expect(result.outputs["publish"]).toBeUndefined();
		}
	});

	test("publishing treats only this version's staged E409 as already published", () => {
		const staged = runStep(publishScript, {
			npmPublish: {
				stderr: `npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/sketchi - Cannot publish over previously staged version "${version}".\n`,
				status: 1,
			},
		});
		expect(staged.status, staged.output).toBe(0);
		expect(runStep(publishScript).status).toBe(0);
		for (const stderr of [
			'npm error code E409\nnpm error 409 Conflict - Cannot publish over previously staged version "0.0.1".\n',
			"npm error code E403\n",
		]) {
			expect(runStep(publishScript, { npmPublish: { stderr, status: 1 } }).status).not.toBe(0);
		}
	});
});

const sha = "a".repeat(40);
const baseSha = "c".repeat(40);
const resolverStep = stepRun(
	workflow("app-preview.yml").jobs["resolve-preview-pr"]?.steps ?? [],
	(step) => step.id === "pr",
);
const resolverScript =
	resolverStep.match(/node --input-type=module <<'NODE'\n([\s\S]+?)\nNODE/)?.[1] ?? "";

/** Runs the resolver as Actions does, against a local stand-in for the GitHub API. */
function resolvePr(
	options: {
		state?: string;
		repository?: string;
		action?: string;
		prNumber?: string;
		eventSha?: string;
		status?: number;
	} = {},
) {
	const dir = scratch("ops-resolver-");
	const output = join(dir, "github-output");
	writeFileSync(output, "");
	const server = join(dir, "api.mjs");
	executable(
		server,
		`import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
const requests = [];
const api = createServer((request, response) => {
	requests.push(request.url);
	response.writeHead(${options.status ?? 200}, { "content-type": "application/json" });
	response.end(JSON.stringify({
		number: 42,
		state: ${JSON.stringify(options.state ?? "open")},
		base: { sha: ${JSON.stringify(baseSha)} },
		head: { sha: ${JSON.stringify(sha)}, repo: { full_name: ${JSON.stringify(options.repository ?? "shpitdev/sketchi")} } },
	}));
}).listen(0, "127.0.0.1", async () => {
	const { port } = api.address();
	const { spawn } = await import("node:child_process");
	const child = spawn("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", process.env.SCRIPT], {
		stdio: ["ignore", "inherit", "inherit"],
		env: { ...process.env, GITHUB_API_URL: "http://127.0.0.1:" + port },
	});
	child.on("exit", (code) => {
		console.log("REQUESTS " + JSON.stringify(requests));
		api.close();
		process.exit(code ?? 1);
	});
});
`,
	);
	const result = spawnSync(server, [], {
		encoding: "utf8",
		env: {
			...process.env,
			SCRIPT: `node --input-type=module <<'NODE'\n${resolverScript}\nNODE`,
			PR_NUMBER: options.prNumber ?? "42",
			PREVIEW_ACTION: options.action ?? "deploy",
			EVENT_HEAD_SHA: options.eventSha ?? "",
			GITHUB_REPOSITORY: "shpitdev/sketchi",
			GITHUB_TOKEN: "offline-test-token",
			GITHUB_OUTPUT: output,
		},
	});
	const requests = JSON.parse(result.stdout.match(/REQUESTS (.*)/)?.[1] ?? "[]") as string[];
	return {
		status: result.status,
		stderr: result.stderr,
		outputs: readFileSync(output, "utf8"),
		requests,
	};
}

describe("preview PR resolver", () => {
	test("returns the PR head rather than the dispatch ref, or the event's immutable head", () => {
		const resolved = resolvePr();
		expect(resolved.outputs).toBe(`pr_number=42\nsha=${sha}\nbase_sha=${baseSha}\n`);
		expect(resolved.requests).toEqual(["/repos/shpitdev/sketchi/pulls/42"]);
		const eventSha = "b".repeat(40);
		expect(resolvePr({ eventSha }).outputs).toContain(`sha=${eventSha}`);
	});

	test("rejects forks, closed deploys, malformed numbers and failed lookups; closed cleanup proceeds", () => {
		for (const [options, message] of [
			[{ repository: "fork/sketchi" }, /same-repository/],
			[{ state: "closed" }, /open PR/],
			[{ prNumber: "42oops" }, /positive integer/],
			[{ prNumber: "4e2" }, /positive integer/],
			[{ prNumber: "9007199254740993" }, /positive integer/],
			[{ status: 404 }, /HTTP 404/],
		] as const) {
			const result = resolvePr(options);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toMatch(message);
			expect(result.outputs).toBe("");
		}
		expect(resolvePr({ state: "closed", action: "cleanup" }).outputs).toContain("pr_number=42");
	});
});
