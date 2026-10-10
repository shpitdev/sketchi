import { join, sep } from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, PlatformError } from "effect";

import { makeLocalFileSystem } from "./filesystem.js";

function probeError(method: string, path: string, code: string) {
	return PlatformError.systemError({
		_tag: code === "ENOENT" ? "NotFound" : "Unknown",
		module: "FileSystem",
		method,
		pathOrDescriptor: path,
		cause: { code },
	});
}

describe("local filesystem directory-entry races", () => {
	for (const probe of ["readLink", "stat"]) {
		it.effect(`skips a lock marker that disappears before ${probe}`, () =>
			Effect.gen(function* () {
				const directory = join(sep, "locks");
				const marker = "owner.vanished.json";
				const path = join(directory, marker);
				const calls: string[] = [];
				const fs = makeLocalFileSystem(
					FileSystem.makeNoop({
						readDirectory: () =>
							Effect.sync(() => {
								calls.push("readDirectory");
								return [marker];
							}),
						readLink: () =>
							Effect.suspend(() => {
								calls.push("readLink");
								return Effect.fail(
									probeError("readLink", path, probe === "readLink" ? "ENOENT" : "EINVAL"),
								);
							}),
						stat: () =>
							Effect.suspend(() => {
								calls.push("stat");
								return Effect.fail(probeError("stat", path, "ENOENT"));
							}),
					}),
				);

				assert.deepStrictEqual(yield* fs.list(directory), []);
				assert.deepStrictEqual(
					calls,
					probe === "readLink"
						? ["readDirectory", "readLink"]
						: ["readDirectory", "readLink", "stat"],
				);
			}),
		);
	}

	it.effect("retains unsafe symlink classifications", () =>
		Effect.gen(function* () {
			const fs = makeLocalFileSystem(
				FileSystem.makeNoop({
					readDirectory: () => Effect.succeed(["owner.link.json"]),
					readLink: () => Effect.succeed("/outside"),
				}),
			);

			assert.deepStrictEqual(yield* fs.list(join(sep, "locks")), [
				{ name: "owner.link.json", kind: "symbolic-link" },
			]);
		}),
	);

	it.effect("does not skip probe failures other than disappearance", () =>
		Effect.gen(function* () {
			const directory = join(sep, "locks");
			const path = join(directory, "owner.denied.json");
			const fs = makeLocalFileSystem(
				FileSystem.makeNoop({
					readDirectory: () => Effect.succeed(["owner.denied.json"]),
					readLink: () => Effect.fail(probeError("readLink", path, "EACCES")),
				}),
			);

			const error = yield* Effect.flip(fs.list(directory));
			assert.strictEqual(error._tag, "CliFilesystemError");
			assert.strictEqual(error.path, path);
			assert.strictEqual(error.operation, "stat");
		}),
	);
});
