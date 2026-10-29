import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { isAssetsUploadSession10013, runWithAssetsUploadRetry } from "./wrangler-retry.mjs";

// Verbatim from the failed `deploy (eval-harness)` job of production run 40909449862.
const session10013 = `🌀 Starting asset upload...

\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERROR\x1b[41;31m]\x1b[0m \x1b[1mA request to the Cloudflare API (/accounts/***/workers/scripts/sketchi-playground/assets-upload-session) failed.\x1b[0m

  An unknown error has occurred. If this error persists, please file a report in workers-sdk (https://github.com/cloudflare/workers-sdk/issues) or reach out to your account team. [code: 10013]
`;

// From the failed `deploy-preview (eval-harness)` job of preview run 40901461058.
const gateway504 = `No updated asset files to upload. Proceeding with deployment...

✘ [ERROR] Received a malformed response from the API

  POST /accounts/***/workers/workers/sketchi-playground/previews/563c3fb9a9ad4e62b350ca9a52f716be/deployments -> 504 Gateway Timeout
`;

const silent = { write() {} };

function scripted(...results) {
	const calls = [];
	return {
		calls,
		run: async (command, args) => {
			calls.push([command, ...args]);
			return results.shift();
		},
	};
}

test("recognizes only the 10013 assets-upload-session failure", () => {
	assert.equal(isAssetsUploadSession10013(session10013), true);
	assert.equal(isAssetsUploadSession10013(gateway504), false);
	assert.equal(isAssetsUploadSession10013(session10013.replace("10013", "10000")), false);
	assert.equal(
		isAssetsUploadSession10013(
			session10013.replace("assets-upload-session", "versions") +
				"\n(/accounts/x/workers/scripts/y/assets-upload-session) failed.",
		),
		false,
		"10013 on another endpoint must not borrow an unrelated session failure",
	);
	assert.equal(
		isAssetsUploadSession10013(
			session10013.replace("10013", "10000") + "\n✘ [ERROR] Something else [code: 10013]",
		),
		false,
		"a session failure only counts with its own 10013 code",
	);
});

test("retries the 10013 session failure twice with backoff, then succeeds", async () => {
	const waits = [];
	const { calls, run } = scripted(
		{ code: 1, output: session10013 },
		{ code: 1, output: session10013 },
		{ code: 0, output: "Uploaded sketchi-playground" },
	);
	const code = await runWithAssetsUploadRetry("wrangler", ["deploy"], {
		run,
		wait: async (ms) => waits.push(ms),
		stdout: silent,
		stderr: silent,
		outputFile: "",
	});
	assert.equal(code, 0);
	assert.equal(calls.length, 3);
	assert.deepEqual(waits, [30_000, 60_000]);
});

test("gives up after two retries", async () => {
	const { calls, run } = scripted(
		{ code: 1, output: session10013 },
		{ code: 1, output: session10013 },
		{ code: 1, output: session10013 },
	);
	const code = await runWithAssetsUploadRetry("wrangler", ["deploy"], {
		run,
		wait: async () => {},
		stdout: silent,
		stderr: silent,
		outputFile: "",
	});
	assert.equal(code, 1);
	assert.equal(calls.length, 3);
});

test("other failures fail fast without waiting", async () => {
	for (const output of [gateway504, "✘ [ERROR] Authentication error [code: 10000]"]) {
		const { calls, run } = scripted({ code: 1, output });
		const code = await runWithAssetsUploadRetry("wrangler", ["deploy"], {
			run,
			wait: async () => assert.fail("must not back off"),
			stdout: silent,
			stderr: silent,
			outputFile: "",
		});
		assert.equal(code, 1);
		assert.equal(calls.length, 1);
	}
});

test("a real child process is retried and each attempt starts with a fresh output file", async () => {
	const dir = mkdtempSync(path.join(tmpdir(), "wrangler-retry-"));
	try {
		const counter = path.join(dir, "attempts");
		const outputFile = path.join(dir, "out.ndjson");
		const fake = path.join(dir, "fake-wrangler.mjs");
		writeFileSync(counter, "0");
		writeFileSync(outputFile, "stale\n");
		writeFileSync(
			fake,
			`import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const attempt = Number(readFileSync(${JSON.stringify(counter)}, "utf8")) + 1;
writeFileSync(${JSON.stringify(counter)}, String(attempt));
if (existsSync(${JSON.stringify(outputFile)})) process.exit(9);
appendFileSync(${JSON.stringify(outputFile)}, "attempt " + attempt + "\\n");
if (attempt < 3) {
	process.stderr.write(${JSON.stringify(session10013)});
	process.exit(1);
}
process.stdout.write("Uploaded");
`,
		);
		let stdout = "";
		const code = await runWithAssetsUploadRetry(process.execPath, [fake], {
			delaysMs: [1, 1],
			stdout: { write: (chunk) => (stdout += chunk) },
			stderr: silent,
			outputFile,
		});
		assert.equal(code, 0);
		assert.equal(readFileSync(counter, "utf8"), "3");
		assert.equal(readFileSync(outputFile, "utf8"), "attempt 3\n");
		assert.equal(stdout, "Uploaded");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("every Cloudflare upload in the deploy workflows goes through the retry wrapper", () => {
	const require = createRequire(import.meta.resolve("nx/package.json"));
	const yaml = require("@zkochan/js-yaml");
	for (const [file, jobName] of [
		["app-production-deploy.yml", "deploy"],
		["app-preview.yml", "deploy-preview"],
	]) {
		const workflow = yaml.load(
			readFileSync(new URL(`../../../.github/workflows/${file}`, import.meta.url), "utf8"),
		);
		const runs = workflow.jobs[jobName].steps
			.map(({ run }) => run ?? "")
			.filter((run) => /wrangler (deploy|preview)/.test(run));
		assert.ok(runs.length > 0, `${file} must upload with Wrangler`);
		for (const run of runs) {
			assert.match(
				run,
				/node scripts\/07-wrangler-retry\.mjs -- pnpm exec wrangler (deploy|preview)/,
			);
		}
	}
});
