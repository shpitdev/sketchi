import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { Effect } from "effect";

import { CliExportError } from "../errors";
import { LocalFileSystem } from "../filesystem";
import { StorageRoot } from "./service";

export const writeExportFile = Effect.fn("sketchi.cli.export.writeFile")(function* (
	destination: string,
	bytes: Uint8Array,
) {
	const fs = yield* LocalFileSystem;
	const root = yield* StorageRoot;
	const absoluteDestination = resolve(destination);
	const parent = dirname(absoluteDestination);
	const destinationDirectoryError = () =>
		CliExportError.make({
			code: "export_write_failed",
			format: basename(destination),
			message: `Export destination directory does not exist: ${parent}.`,
			hint: "Create the destination directory and retry.",
		});
	const resolvedParent = yield* fs
		.realPath(parent)
		.pipe(Effect.mapError(destinationDirectoryError));
	if ((yield* fs.kind(resolvedParent)) !== "directory") {
		return yield* destinationDirectoryError();
	}
	const resolvedRoot = yield* fs.realPath(root.path);
	const resolvedDestination = join(resolvedParent, basename(absoluteDestination));
	const destinationFromRoot = relative(resolvedRoot, resolvedDestination);
	if (
		destinationFromRoot === "" ||
		!(
			destinationFromRoot === ".." ||
			destinationFromRoot.startsWith(".." + sep) ||
			isAbsolute(destinationFromRoot)
		)
	) {
		return yield* CliExportError.make({
			code: "invalid_destination",
			format: basename(destination),
			message: `Export destination is inside Sketchi's diagram storage: ${destination}.`,
			hint: "Choose a destination outside ~/.sketchi/diagrams so the stored record remains valid.",
		});
	}
	const temp = join(
		resolvedParent,
		`.${basename(destination)}.sketchi.${String(process.pid)}.${crypto.randomUUID()}`,
	);
	return yield* Effect.acquireUseRelease(
		Effect.succeed(temp),
		(path) =>
			fs.writeBytes(path, bytes).pipe(
				Effect.andThen(fs.rename(path, resolvedDestination)),
				Effect.mapError(() =>
					CliExportError.make({
						code: "export_write_failed",
						format: basename(destination),
						message: `Unable to write export destination ${destination}.`,
						hint: "Check the destination path and permissions, then retry.",
					}),
				),
			),
		(path) => fs.remove(path),
	);
});
