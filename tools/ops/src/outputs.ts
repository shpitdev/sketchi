import { Config, Console, Effect, FileSystem, Option } from "effect";

import { opsError } from "./process";

/** Prints `key=value` lines and appends them to GitHub's step outputs when Actions provides them. */
export const writeOutputs = Effect.fn("ops.outputs.write")(function* (
	outputs: Readonly<Record<string, string>>,
) {
	const text = Object.entries(outputs)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
	yield* Console.log(text);
	const file = yield* Config.option(Config.String("GITHUB_OUTPUT"));
	if (Option.isNone(file) || !file.value) return;
	const fs = yield* FileSystem.FileSystem;
	yield* fs
		.writeFileString(file.value, `${text}\n`, { flag: "a" })
		.pipe(Effect.mapError((error) => opsError(`Could not write GITHUB_OUTPUT: ${error.message}`)));
});

/** A trimmed environment value, or none when unset or blank. */
export function optionalEnv(name: string) {
	return Config.option(Config.String(name)).pipe(
		Effect.map((value) =>
			Option.filter(
				Option.map(value, (text) => text.trim()),
				Boolean,
			),
		),
		Effect.orDie,
	);
}

export const requiredEnv = Effect.fn("ops.env.required")(function* (name: string) {
	const value = yield* optionalEnv(name);
	if (Option.isNone(value)) return yield* opsError(`${name} is required.`);
	return value.value;
});
