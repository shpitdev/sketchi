// The deploy retry runs a real child process: only Cloudflare's assets-upload-session 10013
// failure is retried, at most twice, and every attempt starts from an empty Wrangler output file.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The retry test inspects the recorded attempts in the subprocess harness directory.
import { readFileSync, writeFileSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- The retry test inspects the recorded attempts in the subprocess harness directory.
import { join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { describe, expect } from "vitest";

import { isAssetsUploadSession10013, runWithAssetsUploadRetry } from "../src/deploy/wrangler-retry";
import { scratch } from "./harness";

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

/** A fake Wrangler that fails its first attempts with the given stderr, then succeeds. */
function fakeWrangler(failures: readonly string[]) {
	const dir = scratch("ops-wrangler-retry-");
	const counter = join(dir, "attempts");
	const outputFile = join(dir, "out.ndjson");
	const script = join(dir, "fake-wrangler.mjs");
	writeFileSync(counter, "0");
	writeFileSync(outputFile, "stale\n");
	writeFileSync(
		script,
		`import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const failures = ${JSON.stringify(failures)};
const attempt = Number(readFileSync(${JSON.stringify(counter)}, "utf8")) + 1;
writeFileSync(${JSON.stringify(counter)}, String(attempt));
if (existsSync(${JSON.stringify(outputFile)})) process.exit(9);
appendFileSync(${JSON.stringify(outputFile)}, "attempt " + attempt + "\\n");
if (attempt <= failures.length) {
	process.stderr.write(failures[attempt - 1]);
	process.exit(1);
}
process.stdout.write("Uploaded\\n");
`,
	);
	const run = runWithAssetsUploadRetry(process.execPath, [script], ["1 millis", "1 millis"]).pipe(
		// @effect-diagnostics-next-line strictEffectProvide:off -- This command harness owns the isolated Node and fixture layers for the test invocation.
		Effect.provide(
			Layer.mergeAll(
				NodeServices.layer,
				ConfigProvider.layer(
					ConfigProvider.fromEnvRecord({ WRANGLER_OUTPUT_FILE_PATH: outputFile }),
				),
			),
		),
	);
	return {
		run,
		attempts: () => Number(readFileSync(counter, "utf8")),
		output: () => readFileSync(outputFile, "utf8"),
	};
}

describe("wrangler retry", () => {
	it.live("retries the 10013 session failure twice, each attempt with a fresh output file", () =>
		Effect.gen(function* () {
			const wrangler = fakeWrangler([session10013, session10013]);
			expect(yield* wrangler.run).toBe(0);
			expect(wrangler.attempts()).toBe(3);
			expect(wrangler.output()).toBe("attempt 3\n");
		}),
	);

	it.live("gives up after two retries", () =>
		Effect.gen(function* () {
			const wrangler = fakeWrangler([session10013, session10013, session10013]);
			expect(yield* wrangler.run).toBe(1);
			expect(wrangler.attempts()).toBe(3);
		}),
	);

	it.live("other failures fail on the first attempt", () =>
		Effect.gen(function* () {
			for (const failure of [gateway504, "✘ [ERROR] Authentication error [code: 10000]"]) {
				const wrangler = fakeWrangler([failure]);
				expect(yield* wrangler.run).toBe(1);
				expect(wrangler.attempts()).toBe(1);
			}
		}),
	);

	it.effect("recognizes only the session endpoint's own 10013 failure", () =>
		Effect.sync(() => {
			expect(isAssetsUploadSession10013(session10013)).toBe(true);
			for (const output of [
				gateway504,
				session10013.replace("10013", "10000"),
				// 10013 on another endpoint must not borrow an unrelated session failure.
				`${session10013.replace("assets-upload-session", "versions")}\n(/accounts/x/workers/scripts/y/assets-upload-session) failed.`,
				// A session failure only counts with its own 10013 code.
				`${session10013.replace("10013", "10000")}\n✘ [ERROR] Something else [code: 10013]`,
			]) {
				expect(isAssetsUploadSession10013(output)).toBe(false);
			}
		}),
	);
});
