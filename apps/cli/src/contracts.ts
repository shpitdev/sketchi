import type {
  ExcalidrawFile,
  PatchableScene,
} from "@sketchi/diagram-agent";
import { Schema } from "effect";

import type { CanonicalDiagramDocument } from "./document.js";

export const RECORD_SCHEMA_VERSION = 1;
export const MANIFEST_FILE = "manifest.json";
export const DOCUMENT_FILE = "document.json";
export const SCENE_FILE = "scene.json";
export const EXCALIDRAW_FILE = "diagram.excalidraw";
export const PNG_FILE = "diagram.png";
export const REVISIONS_DIRECTORY = "revisions";

export type DiagramFormat = "scene" | "excalidraw" | "png";
export type OutputFormat = "text" | "json";

export class DiagramRecordManifest extends Schema.Class<DiagramRecordManifest>(
  "DiagramRecordManifest",
)({
  schemaVersion: Schema.Literal(RECORD_SCHEMA_VERSION),
  id: Schema.String,
  type: Schema.Literals(["flowchart", "mindmap"]),
  title: Schema.String,
  revision: Schema.Int.check(Schema.isGreaterThan(0)),
  formats: Schema.Array(Schema.Literals(["scene", "excalidraw", "png"])),
}) {}

export interface BuiltDiagram {
  readonly id: string;
  readonly type: CanonicalDiagramDocument["type"];
  readonly title: string;
  readonly document: CanonicalDiagramDocument;
  readonly scene: PatchableScene;
  readonly excalidraw: ExcalidrawFile;
  readonly png?: Uint8Array;
}

export interface StoredDiagram {
  readonly manifest: DiagramRecordManifest;
  readonly document: CanonicalDiagramDocument;
  readonly revisions: ReadonlyArray<string>;
}

export interface DiagramSummary {
  readonly id: string;
  readonly type: CanonicalDiagramDocument["type"];
  readonly title: string;
  readonly revision: number;
  readonly formats: ReadonlyArray<DiagramFormat>;
}

export function summaryFromStored(diagram: StoredDiagram): DiagramSummary {
  return {
    id: diagram.manifest.id,
    type: diagram.manifest.type,
    title: diagram.manifest.title,
    revision: diagram.manifest.revision,
    formats: diagram.manifest.formats,
  };
}

export function revisionFileName(revision: number): string {
  return `${String(revision).padStart(6, "0")}.json`;
}
