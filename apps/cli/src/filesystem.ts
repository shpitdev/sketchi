import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { Context, Effect, FileSystem, Layer, type PlatformError } from "effect";

import { CliFilesystemError } from "./errors.js";

export type LocalEntryKind = "file" | "directory" | "symbolic-link" | "other";

export interface LocalEntry {
	readonly name: string;
	readonly kind: LocalEntryKind;
}

export class LocalFileSystem extends Context.Service<
	LocalFileSystem,
	{
		readonly makeDirectory: (
			path: string,
			recursive?: boolean,
		) => Effect.Effect<void, CliFilesystemError>;
		readonly tryWriteText: (
			path: string,
			value: string,
		) => Effect.Effect<boolean, CliFilesystemError>;
		readonly tryLinkFile: (
			source: string,
			destination: string,
		) => Effect.Effect<boolean, CliFilesystemError>;
		readonly makeTempDirectory: (
			parent: string,
			prefix: string,
		) => Effect.Effect<string, CliFilesystemError>;
		readonly list: (path: string) => Effect.Effect<ReadonlyArray<LocalEntry>, CliFilesystemError>;
		readonly kind: (path: string) => Effect.Effect<LocalEntryKind | "missing", CliFilesystemError>;
		readonly realPath: (path: string) => Effect.Effect<string, CliFilesystemError>;
		readonly readText: (path: string) => Effect.Effect<string, CliFilesystemError>;
		readonly readBytes: (path: string) => Effect.Effect<Uint8Array, CliFilesystemError>;
		readonly writeText: (
			path: string,
			value: string,
			replace?: boolean,
		) => Effect.Effect<void, CliFilesystemError>;
		readonly writeBytes: (
			path: string,
			value: Uint8Array,
			replace?: boolean,
		) => Effect.Effect<void, CliFilesystemError>;
		readonly rename: (
			source: string,
			destination: string,
		) => Effect.Effect<void, CliFilesystemError>;
		readonly tryRenameDirectory: (
			source: string,
			destination: string,
		) => Effect.Effect<boolean, CliFilesystemError>;
		readonly removeFile: (path: string) => Effect.Effect<boolean, CliFilesystemError>;
		readonly remove: (path: string) => Effect.Effect<void, CliFilesystemError>;
	}
>()("@sketchi/cli/LocalFileSystem") {}

function filesystemError(operation: string, path: string, cause: unknown) {
	return CliFilesystemError.make({
		cause,
		operation,
		path,
		message: `Filesystem ${operation} failed for ${path}.`,
	});
}

function hasCode(cause: unknown, code: string): boolean {
	return typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;
}

function platformCause(error: PlatformError.PlatformError): unknown {
	return error.reason.cause ?? error;
}

/** Node stat follows links; probe readLink first so entry classification does not. */
export function makeLocalFileSystem(fs: FileSystem.FileSystem): typeof LocalFileSystem.Service {
	const kind = Effect.fn("sketchi.cli.fs.kind")(function* (path: string) {
		const link = yield* fs.readLink(path).pipe(Effect.result);
		if (link._tag === "Success") return "symbolic-link";
		const cause = platformCause(link.failure);
		if (hasCode(cause, "ENOENT")) return "missing";
		if (hasCode(cause, "ELOOP")) return "symbolic-link";
		if (!hasCode(cause, "EINVAL")) return yield* filesystemError("stat", path, cause);
		return yield* fs.stat(path).pipe(
			Effect.map((info): LocalEntryKind => {
				if (info.type === "File") return "file";
				if (info.type === "Directory") return "directory";
				if (info.type === "SymbolicLink") return "symbolic-link";
				return "other";
			}),
			Effect.catch((error) => {
				const cause = platformCause(error);
				if (hasCode(cause, "ENOENT")) return Effect.succeed<LocalEntryKind | "missing">("missing");
				if (hasCode(cause, "ELOOP"))
					return Effect.succeed<LocalEntryKind | "missing">("symbolic-link");
				return Effect.fail(filesystemError("stat", path, cause));
			}),
		);
	});
	const mapError = (operation: string, path: string) => (error: PlatformError.PlatformError) =>
		filesystemError(operation, path, platformCause(error));
	return {
		makeDirectory: (path, recursive = false) =>
			fs.makeDirectory(path, { recursive }).pipe(Effect.mapError(mapError("make-directory", path))),
		tryWriteText: (path, value) =>
			Effect.tryPromise({
				try: async (signal) => {
					try {
						const handle = await open(
							path,
							constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
							0o600,
						);
						try {
							await handle.writeFile(value, { encoding: "utf8", signal });
							await handle.sync();
						} finally {
							await handle.close();
						}
						return true;
					} catch (cause) {
						if (hasCode(cause, "EEXIST")) return false;
						throw cause;
					}
				},
				catch: (cause) => filesystemError("write-exclusive", path, cause),
			}),
		tryLinkFile: (source, destination) =>
			fs.link(source, destination).pipe(
				Effect.as(true),
				Effect.catch((error) => {
					const cause = platformCause(error);
					return hasCode(cause, "EEXIST") || hasCode(cause, "ENOENT")
						? Effect.succeed(false)
						: Effect.fail(filesystemError("link-exclusive", `${source} -> ${destination}`, cause));
				}),
			),
		makeTempDirectory: (parent, prefix) =>
			fs
				.makeTempDirectory({ directory: parent, prefix })
				.pipe(Effect.mapError(mapError("make-temp-directory", parent))),
		list: (path) =>
			fs.readDirectory(path).pipe(
				Effect.mapError(mapError("read-directory", path)),
				Effect.flatMap((names) =>
					Effect.forEach(names, (name) =>
						kind(join(path, name)).pipe(
							// Directory names are a snapshot; vanished entries are not unsafe.
							Effect.map((entryKind): LocalEntry[] =>
								entryKind === "missing" ? [] : [{ name, kind: entryKind }],
							),
						),
					).pipe(Effect.map((entries) => entries.flat())),
				),
			),
		kind,
		realPath: (path) => fs.realPath(path).pipe(Effect.mapError(mapError("resolve", path))),
		readText: (path) =>
			Effect.tryPromise({
				try: async (signal) => {
					const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
					try {
						return await handle.readFile({ encoding: "utf8", signal });
					} finally {
						await handle.close();
					}
				},
				catch: (cause) => filesystemError("read", path, cause),
			}),
		readBytes: (path) =>
			Effect.tryPromise({
				try: async (signal) => {
					const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
					try {
						return new Uint8Array(await handle.readFile({ signal }));
					} finally {
						await handle.close();
					}
				},
				catch: (cause) => filesystemError("read", path, cause),
			}),
		writeText: (path, value, replace = false) =>
			Effect.tryPromise({
				try: async (signal) => {
					const flags =
						constants.O_WRONLY |
						constants.O_CREAT |
						constants.O_NOFOLLOW |
						(replace ? constants.O_TRUNC : constants.O_EXCL);
					const handle = await open(path, flags, 0o600);
					try {
						await handle.writeFile(value, { encoding: "utf8", signal });
						await handle.sync();
					} finally {
						await handle.close();
					}
				},
				catch: (cause) => filesystemError("write", path, cause),
			}),
		writeBytes: (path, value, replace = false) =>
			Effect.tryPromise({
				try: async (signal) => {
					const flags =
						constants.O_WRONLY |
						constants.O_CREAT |
						constants.O_NOFOLLOW |
						(replace ? constants.O_TRUNC : constants.O_EXCL);
					const handle = await open(path, flags, 0o600);
					try {
						await handle.writeFile(value, { signal });
						await handle.sync();
					} finally {
						await handle.close();
					}
				},
				catch: (cause) => filesystemError("write", path, cause),
			}),
		rename: (source, destination) =>
			fs
				.rename(source, destination)
				.pipe(Effect.mapError(mapError("rename", `${source} -> ${destination}`))),
		tryRenameDirectory: (source, destination) =>
			fs.rename(source, destination).pipe(
				Effect.as(true),
				Effect.catch((error) =>
					Effect.gen(function* () {
						const cause = platformCause(error);
						if (hasCode(cause, "EEXIST") || hasCode(cause, "ENOTEMPTY")) return false;
						if (
							hasCode(cause, "EPERM") &&
							(yield* kind(destination).pipe(Effect.catch(() => Effect.succeed("missing")))) ===
								"directory"
						)
							return false;
						return yield* filesystemError(
							"rename-exclusive-directory",
							`${source} -> ${destination}`,
							cause,
						);
					}),
				),
			),
		removeFile: (path) =>
			fs.remove(path).pipe(
				Effect.as(true),
				Effect.catch((error) => {
					const cause = platformCause(error);
					return hasCode(cause, "ENOENT")
						? Effect.succeed(false)
						: Effect.fail(filesystemError("remove-file", path, cause));
				}),
			),
		remove: (path) =>
			fs
				.remove(path, { recursive: true, force: true })
				.pipe(Effect.mapError(mapError("remove", path))),
	};
}

export const LocalFileSystemLive = Layer.effect(
	LocalFileSystem,
	Effect.map(FileSystem.FileSystem, makeLocalFileSystem),
);
