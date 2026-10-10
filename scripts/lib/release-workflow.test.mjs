import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.resolve("nx/package.json"));
const yaml = require("@zkochan/js-yaml");
const release = yaml.load(
	readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"),
).jobs;
const guardScript = release.guard.steps.find((step) => step.id === "check").run;
const publishScript = release.publish.steps.find((step) => step.run?.includes("npm publish")).run;
const cliManifest = readFileSync(new URL("../../apps/cli/package.json", import.meta.url), "utf8");
const version = JSON.parse(cliManifest).version;

/**
 * Runs a release step the way GitHub Actions does, with `git` and `npm`
 * replaced by stubs that print the given output and exit with the given code.
 */
function runStep(script, { git = {}, npmView = {}, npmPublish = {} } = {}) {
	const directory = mkdtempSync(join(tmpdir(), "sketchi-release-"));
	// Steps run from a scratch checkout holding only the CLI manifest, so the
	// guard's scratch files never land in the repository.
	const checkout = join(directory, "checkout");
	mkdirSync(join(checkout, "apps", "cli"), { recursive: true });
	writeFileSync(join(checkout, "apps", "cli", "package.json"), cliManifest);
	try {
		const stub = (name, body) => {
			writeFileSync(join(directory, name), `#!/bin/bash\n${body}\n`);
			chmodSync(join(directory, name), 0o755);
		};
		const reply = ({ stdout = "", stderr = "", status = 0 }) =>
			`printf '%s' ${JSON.stringify(stdout)}; printf '%s' ${JSON.stringify(stderr)} >&2; exit ${status}`;
		stub("git", `[ "$1" = ls-remote ] && { ${reply(git)}; }; exit 64`);
		stub(
			"npm",
			[
				`[ "$1" = view ] && { ${reply(npmView)}; }`,
				`[ "$1" = publish ] && { ${reply(npmPublish)}; }`,
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
				PATH: `${directory}:${process.env.PATH}`,
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
	} finally {
		rmSync(directory, { force: true, recursive: true });
	}
}

const missingVersion = { stderr: "npm error code E404", status: 1 };

test("the release guard skips a version whose tag exists while npm still stages it", () => {
	const result = runStep(guardScript, {
		git: { stdout: `abc123\trefs/tags/cli-v${version}\n` },
		npmView: missingVersion,
	});
	assert.equal(result.status, 0, result.output);
	assert.deepEqual(result.outputs, { publish: "false", version });
});

test("the release guard publishes an untagged version missing from npm", () => {
	const result = runStep(guardScript, { npmView: missingVersion });
	assert.equal(result.status, 0, result.output);
	assert.deepEqual(result.outputs, { publish: "true", version });
});

test("the release guard skips a version npm already serves", () => {
	const result = runStep(guardScript, { npmView: { stdout: version } });
	assert.equal(result.status, 0, result.output);
	assert.deepEqual(result.outputs, { publish: "false", version });
});

test("the release guard fails closed when the tag or registry lookup fails", () => {
	const tagLookup = runStep(guardScript, {
		git: { stderr: "fatal: unable to access", status: 128 },
	});
	assert.notEqual(tagLookup.status, 0);
	assert.equal(tagLookup.outputs.publish, undefined);

	const registryLookup = runStep(guardScript, {
		npmView: { stderr: "npm error code ECONNRESET", status: 1 },
	});
	assert.notEqual(registryLookup.status, 0);
	assert.equal(registryLookup.outputs.publish, undefined);
});

test("publishing treats this version's staged E409 as already published", () => {
	const staged = runStep(publishScript, {
		npmPublish: {
			stderr: `npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/sketchi - Cannot publish over previously staged version "${version}".\n`,
			status: 1,
		},
	});
	assert.equal(staged.status, 0, staged.output);
	assert.match(staged.output, /already staged on npm; treating it as published/);

	assert.equal(runStep(publishScript).status, 0);
});

test("publishing still fails for other conflicts and errors", () => {
	const otherVersion = runStep(publishScript, {
		npmPublish: {
			stderr:
				'npm error code E409\nnpm error 409 Conflict - Cannot publish over previously staged version "0.0.1".\n',
			status: 1,
		},
	});
	assert.notEqual(otherVersion.status, 0);

	const forbidden = runStep(publishScript, {
		npmPublish: { stderr: "npm error code E403\n", status: 1 },
	});
	assert.notEqual(forbidden.status, 0);
});
