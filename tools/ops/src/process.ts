import { Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

/** An operator command's failure. The message is what the operator reads. */
export class OpsError extends Schema.TaggedError<OpsError, { readonly brand: unique symbol }>()(
	"OpsError",
	{
		message: Schema.String,
	},
) {}

export function opsError(message: string) {
	return new OpsError({ message });
}

/** Runs synchronous validation that reports failure by throwing, as the Vite-shared code does. */
export function attempt<A>(run: () => A) {
	return Effect.try({
		try: run,
		catch: (error) => opsError(error instanceof Error ? error.message : String(error)),
	});
}

export interface RunOptions {
	readonly cwd?: string;
	readonly env?: Record<string, string | undefined>;
	/** Replace the inherited environment with `env` instead of extending it. */
	readonly replaceEnv?: boolean;
}

/**
 * The process group gets SIGTERM when its scope closes early (interruption or timeout), and
 * SIGKILL if it is still running after this grace period.
 */
const KILL = { killSignal: "SIGTERM", forceKillAfter: "10 seconds" } as const;

function command(file: string, args: readonly string[], options: RunOptions) {
	return ChildProcess.make(file, args, {
		...KILL,
		...(options.cwd ? { cwd: options.cwd } : {}),
		...(options.env ? { env: options.env } : {}),
		extendEnv: !options.replaceEnv,
	});
}

const decoder = () => {
	const text = new TextDecoder();
	return (chunks: Iterable<Uint8Array>) => {
		let out = "";
		for (const chunk of chunks) out += text.decode(chunk, { stream: true });
		return out + text.decode();
	};
};

/** Runs a command to completion, capturing its exit code, stdout and stderr. */
export const capture = Effect.fn("ops.process.capture")(function* (
	file: string,
	args: readonly string[],
	options: RunOptions = {},
) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const handle = yield* command(file, args, options);
			const [stdout, stderr, code] = yield* Effect.all(
				[Stream.runCollect(handle.stdout), Stream.runCollect(handle.stderr), handle.exitCode],
				{ concurrency: "unbounded" },
			);
			return { code: Number(code), stdout: decoder()(stdout), stderr: decoder()(stderr) };
		}),
	);
});

/** Stdout of a command that must succeed; its stderr becomes the failure message. */
export const output = Effect.fn("ops.process.output")(function* (
	file: string,
	args: readonly string[],
	options: RunOptions = {},
) {
	const result = yield* capture(file, args, options).pipe(
		Effect.mapError((error) => opsError(`${file} ${args.join(" ")}: ${error.message}`)),
	);
	if (result.code !== 0) {
		return yield* opsError(
			`${file} ${args.join(" ")} failed with exit status ${result.code}${result.stderr.trim() ? `:\n${result.stderr.trim()}` : "."}`,
		);
	}
	return result.stdout;
});

/**
 * Runs a command with stdout and stderr interleaved into `logFile`. A command that cannot start
 * exits 127 with the reason in its log.
 */
export const runToLog = Effect.fn("ops.process.runToLog")(function* (
	file: string,
	args: readonly string[],
	logFile: string,
	options: RunOptions = {},
) {
	const fs = yield* FileSystem.FileSystem;
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const handle = yield* command(file, args, options);
			const [, code] = yield* Effect.all(
				[Stream.run(handle.all, fs.sink(logFile)), handle.exitCode],
				{ concurrency: "unbounded" },
			);
			return Number(code);
		}),
	).pipe(
		Effect.catchTag("PlatformError", (error) =>
			fs.writeFileString(logFile, `${error.message}\n`).pipe(Effect.orDie, Effect.as(127)),
		),
	);
});

/**
 * Runs a command with inherited stdio and returns its exit code. It stays in our process group,
 * so an interactive child such as DuckDB keeps the terminal and receives Ctrl-C itself.
 */
export const runInherited = Effect.fn("ops.process.runInherited")(function* (
	file: string,
	args: readonly string[],
	options: RunOptions = {},
) {
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const handle = yield* ChildProcess.make(file, args, {
				...KILL,
				...(options.cwd ? { cwd: options.cwd } : {}),
				...(options.env ? { env: options.env } : {}),
				extendEnv: !options.replaceEnv,
				detached: false,
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			return Number(yield* handle.exitCode);
		}),
	).pipe(Effect.mapError((error) => opsError(`Could not run ${file}: ${error.message}`)));
});
