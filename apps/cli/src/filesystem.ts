import { join } from "node:path";

import { Context, Effect, FileSystem, Layer, Option, type PlatformError } from "effect";

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
		/** Last modification time in epoch milliseconds, or undefined when unknown. */
		readonly modifiedAt: (path: string) => Effect.Effect<number | undefined, CliFilesystemError>;
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

/**
 * Native no-follow open refuses a symlink at the final path component on POSIX. Windows has
 * no O_NOFOLLOW, so there the open follows links as releases up to 0.42.3 did; `kind` and the
 * store's tree checks still refuse the links they see.
 */
const NO_FOLLOW = process.platform !== "win32";
const READ_CHUNK_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function kindOf(info: FileSystem.File.Info): LocalEntryKind {
	switch (info.type) {
		case "File":
			return "file";
		case "Directory":
			return "directory";
		case "SymbolicLink":
			return "symbolic-link";
		default:
			return "other";
	}
}

/** Reads an open descriptor to end of file, not to a size taken before the read. */
const readToEnd = Effect.fnUntraced(function* (file: FileSystem.File) {
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const chunk = yield* file.readAlloc(READ_CHUNK_BYTES);
		if (Option.isNone(chunk)) break;
		chunks.push(chunk.value);
		size += chunk.value.byteLength;
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
});

export function makeLocalFileSystem(fs: FileSystem.FileSystem): typeof LocalFileSystem.Service {
	const mapError = (operation: string, path: string) => (error: PlatformError.PlatformError) =>
		filesystemError(operation, path, platformCause(error));
	const kind = Effect.fn("sketchi.cli.fs.kind")((path: string) =>
		fs.lstat(path).pipe(
			Effect.map((info): LocalEntryKind | "missing" => kindOf(info)),
			Effect.catch((error) => {
				const cause = platformCause(error);
				if (hasCode(cause, "ENOENT")) return Effect.succeed("missing" as const);
				// A looping parent link is still a link the store must refuse.
				if (hasCode(cause, "ELOOP")) return Effect.succeed("symbolic-link" as const);
				return Effect.fail(filesystemError("stat", path, cause));
			}),
		),
	);
	const readNoFollow = (path: string) =>
		Effect.scoped(
			fs.open(path, { flag: "r", noFollow: NO_FOLLOW }).pipe(Effect.flatMap(readToEnd)),
		).pipe(Effect.mapError(mapError("read", path)));
	/** One no-follow descriptor, owner-only, synced before it closes. */
	const writeNoFollow = (path: string, bytes: Uint8Array, flag: "w" | "wx") =>
		Effect.scoped(
			Effect.gen(function* () {
				const file = yield* fs.open(path, { flag, mode: 0o600, noFollow: NO_FOLLOW });
				yield* file.writeAll(bytes);
				yield* file.sync;
			}),
		);
	const write = (path: string, bytes: Uint8Array, replace: boolean) =>
		writeNoFollow(path, bytes, replace ? "w" : "wx").pipe(Effect.mapError(mapError("write", path)));
	return {
		makeDirectory: (path, recursive = false) =>
			fs.makeDirectory(path, { recursive }).pipe(Effect.mapError(mapError("make-directory", path))),
		tryWriteText: (path, value) =>
			writeNoFollow(path, textEncoder.encode(value), "wx").pipe(
				Effect.as(true),
				Effect.catch((error) => {
					const cause = platformCause(error);
					return hasCode(cause, "EEXIST")
						? Effect.succeed(false)
						: Effect.fail(filesystemError("write-exclusive", path, cause));
				}),
			),
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
		modifiedAt: (path) =>
			fs.stat(path).pipe(
				Effect.map((info) => Option.getOrUndefined(info.mtime)?.getTime()),
				Effect.mapError(mapError("stat", path)),
			),
		readText: (path) => readNoFollow(path).pipe(Effect.map((bytes) => textDecoder.decode(bytes))),
		readBytes: readNoFollow,
		writeText: (path, value, replace = false) => write(path, textEncoder.encode(value), replace),
		writeBytes: (path, value, replace = false) => write(path, value, replace),
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
