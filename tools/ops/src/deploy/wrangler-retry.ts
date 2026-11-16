import { Console, Duration, Effect, FileSystem, Option, Stdio, Stream } from "effect";
import { ChildProcess } from "effect/process";

import { optionalEnv } from "../outputs";
import { opsError } from "../process";

// Cloudflare sometimes answers the asset-upload session request with an HTTP 500
// that Wrangler reports as code 10013 (cloudflare/workers-sdk#16447). Nothing is
// uploaded before it fails, so a later attempt is safe. Every other failure,
// including other codes on the same endpoint, still fails on the first attempt.
const ASSETS_UPLOAD_SESSION_10013 =
	/\/workers\/scripts\/[^/\s)]+\/assets-upload-session\) failed\.(?:(?!\[code: )[\s\S])*\[code: 10013\]/;

// oxlint-disable-next-line no-control-regex -- strips Wrangler's ANSI colour codes
const ANSI = /\x1b\[[0-9;]*m/g;

export const assetsUploadRetryDelays: readonly Duration.Input[] = ["30 seconds", "60 seconds"];

export function isAssetsUploadSession10013(output: string) {
	return ASSETS_UPLOAD_SESSION_10013.test(output.replace(ANSI, ""));
}

/** One attempt: output streams through to ours and is kept for the retry decision. */
const attemptOnce = Effect.fn("ops.wrangler.attempt")(function* (
	file: string,
	args: readonly string[],
) {
	const stdio = yield* Stdio.Stdio;
	let output = "";
	const text = new TextDecoder();
	const tee = <E>(stream: Stream.Stream<Uint8Array, E>, sink: typeof stdio.stdout) =>
		stream.pipe(
			Stream.tap((chunk) =>
				Effect.sync(() => {
					output += text.decode(chunk, { stream: true });
				}),
			),
			Stream.run(sink({ endOnDone: false })),
		);
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const handle = yield* ChildProcess.make(file, args, {
				stdin: "inherit",
				killSignal: "SIGTERM",
				forceKillAfter: "10 seconds",
			});
			const [, , code] = yield* Effect.all(
				[
					tee(handle.stdout, (options) => stdio.stdout(options)),
					tee(handle.stderr, (options) => stdio.stderr(options)),
					handle.exitCode,
				],
				{ concurrency: "unbounded" },
			);
			return { code: Number(code), output };
		}),
	).pipe(Effect.mapError((error) => opsError(`Could not run ${file}: ${String(error)}`)));
});

/**
 * Runs a deploy command, retrying only Cloudflare's assets-upload-session 10013 failure, at most
 * once per delay. Wrangler appends to WRANGLER_OUTPUT_FILE_PATH, so each attempt starts from an
 * empty one.
 */
export const runWithAssetsUploadRetry = Effect.fn("ops.wrangler.retry")(function* (
	file: string,
	args: readonly string[],
	delays: readonly Duration.Input[] = assetsUploadRetryDelays,
) {
	const fs = yield* FileSystem.FileSystem;
	const outputFile = yield* optionalEnv("WRANGLER_OUTPUT_FILE_PATH");
	for (let attempt = 0; ; attempt += 1) {
		if (Option.isSome(outputFile)) {
			yield* fs.remove(outputFile.value, { force: true }).pipe(Effect.orDie);
		}
		const result = yield* attemptOnce(file, args);
		if (result.code === 0) return 0;
		const delay = delays[attempt];
		if (delay === undefined || !isAssetsUploadSession10013(result.output)) return result.code;
		yield* Console.error(
			`::warning::Cloudflare assets-upload-session failed with code 10013; retry ${attempt + 1} of ${delays.length} in ${Duration.toSeconds(delay)}s.`,
		);
		yield* Effect.sleep(delay);
	}
});
