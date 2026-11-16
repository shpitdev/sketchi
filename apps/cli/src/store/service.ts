import { homedir } from "node:os";
import { join } from "node:path";

import { Context, Effect, Layer } from "effect";

import type {
	BuiltDiagram,
	DiagramFormat,
	DiagramListEntry,
	PatchedDiagramArtifacts,
	PatchSource,
	StoredDiagram,
} from "../contracts.js";
import type { CanonicalDiagramDocument } from "../document.js";
import type { CliExportError, CliFilesystemError, CliStorageError } from "../errors.js";
import type { LocalFileSystem } from "../filesystem.js";

export class StorageRoot extends Context.Service<StorageRoot, { readonly path: string }>()(
	"@sketchi/cli/StorageRoot",
) {}

export type ExportSource =
	| { readonly _tag: "StoredArtifact"; readonly bytes: Uint8Array }
	| {
			readonly _tag: "RenderPng";
			readonly scene?: Uint8Array;
			readonly excalidraw: Uint8Array;
	  };

export type RevisionSource =
	| {
			readonly _tag: "LegacyDocument";
			readonly revision: number;
			readonly document: CanonicalDiagramDocument;
	  }
	| { readonly _tag: "FullSnapshot"; readonly revision: number };

export interface RestoreResult {
	readonly diagram: StoredDiagram;
	readonly restoredFromRevision: number;
}

export class DiagramStore extends Context.Service<
	DiagramStore,
	{
		readonly create: (
			diagram: BuiltDiagram,
		) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
		/** expectedRevision, when given, refuses the edit if the record moved past it. */
		readonly edit: (
			diagramId: string,
			diagram: BuiltDiagram,
			expectedRevision?: number,
		) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
		readonly readPatchSource: (
			diagramId: string,
		) => Effect.Effect<PatchSource, CliFilesystemError | CliStorageError>;
		readonly commitPatch: (
			diagramId: string,
			expectedRevision: number,
			artifacts: PatchedDiagramArtifacts,
		) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
		readonly replaceWithDetached: (
			diagramId: string,
			excalidraw: Uint8Array,
			expectedRevision?: number,
		) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
		readonly readRevision: (
			diagramId: string,
			revision: number,
		) => Effect.Effect<RevisionSource, CliFilesystemError | CliStorageError>;
		readonly restore: (
			diagramId: string,
			revision: number,
			legacyDiagram?: BuiltDiagram,
		) => Effect.Effect<RestoreResult, CliFilesystemError | CliStorageError>;
		readonly show: (
			diagramId: string,
		) => Effect.Effect<StoredDiagram, CliFilesystemError | CliStorageError>;
		readonly list: () => Effect.Effect<
			ReadonlyArray<DiagramListEntry>,
			CliFilesystemError | CliStorageError
		>;
		/** Visible record ids in code-unit order, without loading any record. */
		readonly ids: () => Effect.Effect<ReadonlyArray<string>, CliFilesystemError | CliStorageError>;
		readonly readExportSource: (
			diagramId: string,
			format: DiagramFormat,
		) => Effect.Effect<ExportSource, CliExportError | CliFilesystemError | CliStorageError>;
	}
>()("@sketchi/cli/DiagramStore") {}

export const StorageRootLive = Layer.succeed(StorageRoot, {
	path: join(homedir(), ".sketchi", "diagrams"),
});

export function makeStorageRootLayer(path: string) {
	return Layer.succeed(StorageRoot, { path });
}

/** What every store operation reads: the local filesystem and the storage root. */
export interface StoreContext {
	readonly fs: (typeof LocalFileSystem)["Service"];
	readonly root: (typeof StorageRoot)["Service"];
}
