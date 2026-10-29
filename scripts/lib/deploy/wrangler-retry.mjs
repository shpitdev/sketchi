import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

// Cloudflare sometimes answers the asset-upload session request with an HTTP 500
// that Wrangler reports as code 10013 (cloudflare/workers-sdk#16447). Nothing is
// uploaded before it fails, so a later attempt is safe. Every other failure,
// including other codes on the same endpoint, still fails on the first attempt.
const ASSETS_UPLOAD_SESSION_10013 =
	/\/workers\/scripts\/[^/\s)]+\/assets-upload-session\) failed\.(?:(?!\[code: )[\s\S])*\[code: 10013\]/;

export const assetsUploadRetryDelaysMs = Object.freeze([30_000, 60_000]);

export function isAssetsUploadSession10013(output) {
	// oxlint-disable-next-line no-control-regex -- strips Wrangler's ANSI colour codes
	return ASSETS_UPLOAD_SESSION_10013.test(output.replace(/\x1b\[[0-9;]*m/g, ""));
}

function runOnce(command, args, { stdout, stderr }) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
			stdout.write(chunk);
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
			stderr.write(chunk);
		});
		child.on("error", reject);
		child.on("close", (code, signal) => resolve({ code: code ?? 1, output, signal }));
	});
}

export async function runWithAssetsUploadRetry(
	command,
	args,
	{
		delaysMs = assetsUploadRetryDelaysMs,
		run = runOnce,
		wait = sleep,
		stdout = process.stdout,
		stderr = process.stderr,
		outputFile = process.env.WRANGLER_OUTPUT_FILE_PATH,
	} = {},
) {
	for (let attempt = 0; ; attempt += 1) {
		// Wrangler appends to its output file, so each attempt starts from an empty one.
		if (outputFile) rmSync(outputFile, { force: true });
		const result = await run(command, args, { stdout, stderr });
		if (result.code === 0 || result.signal) return result.code;
		if (attempt >= delaysMs.length || !isAssetsUploadSession10013(result.output)) {
			return result.code;
		}
		const delayMs = delaysMs[attempt];
		stderr.write(
			`::warning::Cloudflare assets-upload-session failed with code 10013; retry ${attempt + 1} of ${delaysMs.length} in ${delayMs / 1000}s.\n`,
		);
		await wait(delayMs);
	}
}
