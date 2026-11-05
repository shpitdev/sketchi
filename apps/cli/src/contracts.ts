import {
	CANONICAL_DOCUMENT_TYPES,
	type ExcalidrawFile,
	type CodeModeIssue,
	type PatchableScene,
} from "@sketchi/diagram-agent";
import { Effect, Schema } from "effect";

import type { DiagramDocument } from "./document.js";

export const RECORD_SCHEMA_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";
export const DOCUMENT_FILE = "document.json";
export const SCENE_FILE = "scene.json";
export const EXCALIDRAW_FILE = "diagram.excalidraw";
export const PNG_FILE = "diagram.png";
export const REVISIONS_DIRECTORY = "revisions";

export type DiagramFormat = "scene" | "excalidraw" | "png";
export type OutputFormat = "text" | "json";
export type DiagramAuthority = "canonical" | "patched" | "detached";

export class DiagramRecordManifest extends Schema.Class<DiagramRecordManifest>(
	"DiagramRecordManifest",
)({
	schemaVersion: Schema.Literal(RECORD_SCHEMA_VERSION),
	id: Schema.String,
	type: Schema.Literals(["canvas", ...CANONICAL_DOCUMENT_TYPES]),
	title: Schema.String,
	revision: Schema.Int.check(Schema.isGreaterThan(0)),
	authority: Schema.Literals(["canonical", "patched", "detached"]).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("canonical")),
	),
	formats: Schema.Array(Schema.Literals(["scene", "excalidraw", "png"])),
	/**
	 * Additive provenance, still schema version 1: records written before these keys
	 * existed decode without them, and older CLIs ignore them when reading new records.
	 */
	createdAt: Schema.optionalKey(Schema.String),
	prompt: Schema.optionalKey(Schema.String),
}) {}

/** Creation provenance every later revision of a record keeps. */
export function recordProvenance(manifest: DiagramRecordManifest): {
	readonly createdAt?: string;
	readonly prompt?: string;
} {
	return {
		...(manifest.createdAt === undefined ? {} : { createdAt: manifest.createdAt }),
		...(manifest.prompt === undefined ? {} : { prompt: manifest.prompt }),
	};
}

export interface BuiltDiagram {
	readonly warnings?: ReadonlyArray<CodeModeIssue>;
	readonly id: string;
	readonly type: DiagramDocument["type"];
	readonly title: string;
	readonly document: DiagramDocument;
	readonly scene: PatchableScene;
	readonly excalidraw: ExcalidrawFile;
	readonly png?: Uint8Array;
	/** The request text a generated diagram came from. */
	readonly prompt?: string;
}

export interface PatchSource {
	readonly revision: number;
	readonly scene: PatchableScene;
}

export interface PatchedDiagramArtifacts {
	readonly scene: PatchableScene;
	readonly excalidraw: ExcalidrawFile;
}

export interface StoredDiagram {
	/** Warnings for this invocation; not persisted as record state. */
	readonly warnings?: ReadonlyArray<CodeModeIssue>;
	readonly manifest: DiagramRecordManifest;
	readonly document: DiagramDocument;
	readonly revisions: ReadonlyArray<string>;
	readonly authority: DiagramAuthority;
}

export interface DiagramSummary {
	readonly id: string;
	readonly type: DiagramDocument["type"];
	readonly title: string;
	readonly revision: number;
	readonly formats: ReadonlyArray<DiagramFormat>;
	readonly authority: DiagramAuthority;
	readonly documentAuthoritative: boolean;
	/** ISO time the record was created; absent on records older than this field. */
	readonly createdAt?: string;
	/** The generate prompt, for generated records. */
	readonly prompt?: string;
	/** ISO time the record last changed on disk; set by list. */
	readonly updatedAt?: string;
}

/** Failed entries deliberately carry no inferred record metadata. */
export interface DiagramListFailure extends Partial<DiagramSummary> {
	readonly id: string;
	readonly status: "unavailable";
	readonly code: string;
	readonly message: string;
	readonly hint: string;
}

export type DiagramListEntry = DiagramSummary | DiagramListFailure;

export function summaryFromStored(diagram: StoredDiagram): DiagramSummary {
	return {
		id: diagram.manifest.id,
		type: diagram.manifest.type,
		title: diagram.manifest.title,
		revision: diagram.manifest.revision,
		formats: diagram.manifest.formats,
		authority: diagram.authority,
		documentAuthoritative: diagram.authority === "canonical",
		...recordProvenance(diagram.manifest),
	};
}

export function revisionFileName(revision: number): string {
	return `${String(revision).padStart(6, "0")}.json`;
}

export function revisionDirectoryName(revision: number): string {
	return String(revision).padStart(6, "0");
}
