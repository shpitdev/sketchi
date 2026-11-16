import { join } from "node:path";

import {
	EXCALIDRAW_FILE,
	PNG_FILE,
	SCENE_FILE,
	type DiagramAuthority,
	type DiagramFormat,
} from "../contracts.js";
import { CliStorageError, type CliFilesystemError } from "../errors.js";
import type { LocalEntry } from "../filesystem.js";

export const LOCKS_DIRECTORY = ".locks";
export const BACKUP_PREFIX = ".backup.";
export const STAGE_PREFIX = `.stage.${String(process.pid)}.`;

export function storageError(
	code: CliStorageError["code"],
	message: string,
	hint: string,
	diagramId?: string,
) {
	return CliStorageError.make({
		code,
		message,
		hint,
		...(diagramId ? { diagramId } : {}),
	});
}

export function encodedId(id: string): string {
	return Buffer.from(id, "utf8").toString("base64url");
}

export function decodedId(value: string): string | undefined {
	try {
		const id = Buffer.from(value, "base64url").toString("utf8");
		return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) ? id : undefined;
	} catch {
		return undefined;
	}
}

export function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function compareRevisionEntries(left: string, right: string): number {
	const leftDigits = left.replace(/(?:\/|\.json)$/u, "").replace(/^0+/u, "");
	const rightDigits = right.replace(/(?:\/|\.json)$/u, "").replace(/^0+/u, "");
	const lengthComparison = leftDigits.length - rightDigits.length;
	return lengthComparison !== 0
		? lengthComparison
		: compareCodeUnits(leftDigits, rightDigits) || compareCodeUnits(left, right);
}

export function formatsFor(
	authority: DiagramAuthority,
	hasPng: boolean,
): ReadonlyArray<DiagramFormat> {
	const formats: DiagramFormat[] =
		authority === "detached" ? ["excalidraw"] : ["scene", "excalidraw"];
	return hasPng ? [...formats, "png"] : formats;
}

export function filesystemErrorHasCode(error: CliFilesystemError, code: string): boolean {
	return (
		typeof error.cause === "object" &&
		error.cause !== null &&
		"code" in error.cause &&
		error.cause.code === code
	);
}

export function recordPath(root: string, diagramId: string): string {
	return join(root, diagramId);
}

export function artifactFile(format: DiagramFormat): string {
	switch (format) {
		case "scene":
			return SCENE_FILE;
		case "excalidraw":
			return EXCALIDRAW_FILE;
		case "png":
			return PNG_FILE;
	}
}

export function isVisibleRecord(entry: LocalEntry): boolean {
	return entry.kind === "directory" && !entry.name.startsWith(".");
}

export function unsafeEntry(path: string, diagramId?: string) {
	return storageError(
		"unsafe_storage_entry",
		`Unsafe local storage entry at ${path}.`,
		"Replace symbolic links or special files with ordinary Sketchi record files.",
		diagramId,
	);
}
