import { type StoredDiagram, summaryFromStored } from "../contracts";
import type { GeneratedArtifact } from "../generate-workflow";

export function storageLocation(id: string): string {
	return `~/.sketchi/diagrams/${id}`;
}

export function revisionLocations(diagram: StoredDiagram): ReadonlyArray<string> {
	return diagram.revisions.map(
		(revision) => `${storageLocation(diagram.manifest.id)}/revisions/${revision}`,
	);
}

export function storedData(diagram: StoredDiagram) {
	return {
		...summaryFromStored(diagram),
		storagePath: storageLocation(diagram.manifest.id),
		revisions: revisionLocations(diagram),
		document: diagram.document,
		...(diagram.warnings?.length ? { warnings: diagram.warnings } : {}),
	};
}

export function warningLines(diagram: StoredDiagram): string[] {
	return (diagram.warnings ?? []).map(
		(warning) => `warning (${warning.code}): ${warning.message} ${warning.hint}`,
	);
}

export function summaryText(
	action: "created" | "edited" | "patched",
	diagram: StoredDiagram,
): string {
	return [
		`${action}: ${diagram.manifest.id}`,
		`type: ${diagram.manifest.type}`,
		`title: ${diagram.manifest.title}`,
		`revision: ${String(diagram.manifest.revision)}`,
		`authority: ${diagram.authority}`,
		`document authoritative: ${String(diagram.authority === "canonical")}`,
		`formats: ${diagram.manifest.formats.join(",")}`,
		`storage: ${storageLocation(diagram.manifest.id)}`,
		...warningLines(diagram),
	].join("\n");
}

/** One aligned "Label    value" row of human status output. */
export function row(label: string, value: string): string {
	return `${label.padEnd(10)}${value}`;
}

export function headline(diagram: StoredDiagram): string {
	return `${diagram.manifest.title} (${diagram.manifest.type})`;
}

export const COPIED_ROW = row("Copied", "to clipboard, paste anywhere");

export function exportData(result: GeneratedArtifact) {
	const hint = displayHint(result);
	return {
		id: result.id,
		format: result.format,
		destination: result.destination,
		sizeBytes: result.sizeBytes,
		...(hint ? { hint } : {}),
	};
}

export function displayHint(result: GeneratedArtifact): string | undefined {
	const markdownDestination = [...result.destination]
		.map((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint < 0x20 ||
				(codePoint >= 0x80 && codePoint <= 0x9f) ||
				codePoint === 0x7f ||
				codePoint === 0x2028 ||
				codePoint === 0x2029 ||
				"%<>#?\\".includes(character)
				? encodeURIComponent(character)
				: character;
		})
		.join("");
	return result.format === "png" && result.destination !== "-"
		? `to show this diagram to the user, display the exported file as an inline markdown image, e.g. ![${result.id}](<${markdownDestination}>)`
		: undefined;
}
