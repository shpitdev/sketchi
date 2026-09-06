import { join, resolve } from "node:path";

import { Effect } from "effect";

import type { DiagramFormat, StoredDiagram } from "./contracts.js";
import { DiagramExporter } from "./exporter.js";
import {
  generateDiagram,
  type GenerateDiagramInput,
  type GenerateDiagramResult,
} from "./generation.js";
import { LocalFileSystem } from "./filesystem.js";
import {
  CliExportError,
  type CliFilesystemError,
  type CliStorageError,
} from "./errors.js";
import { writeExportFile } from "./storage.js";

export type GenerationDestination =
  | { readonly _tag: "Default" }
  | { readonly _tag: "CurrentDirectory"; readonly cwd: string }
  | { readonly _tag: "ProjectDiagrams"; readonly cwd: string }
  | { readonly _tag: "Custom"; readonly path: string };

export interface GenerateWorkflowInput extends GenerateDiagramInput {
  readonly format: DiagramFormat;
  readonly destination: GenerationDestination;
}

export interface GeneratedArtifact {
  readonly id: string;
  readonly format: DiagramFormat;
  readonly destination: string;
  readonly sizeBytes: number;
  readonly stdoutBytes?: Uint8Array;
}

export interface GenerateWorkflowResult {
  readonly generated: GenerateDiagramResult;
  readonly artifact: GeneratedArtifact;
}

export function generatedDestination(
  id: string,
  format: DiagramFormat,
): string {
  switch (format) {
    case "png":
      return `${id}.png`;
    case "excalidraw":
      return `${id}.excalidraw`;
    case "scene":
      return `${id}.scene.json`;
  }
}

function resolveDestination(
  id: string,
  format: DiagramFormat,
  destination: GenerationDestination,
): string {
  switch (destination._tag) {
    case "Default":
      return generatedDestination(id, format);
    case "CurrentDirectory":
      return resolve(destination.cwd, generatedDestination(id, "png"));
    case "ProjectDiagrams":
      return resolve(
        destination.cwd,
        "diagrams",
        generatedDestination(id, "png"),
      );
    case "Custom":
      return destination.path;
  }
}

export const exportCreatedDiagram = Effect.fn(
  "sketchi.cli.exportCreatedDiagram",
)(function* (
  diagram: StoredDiagram,
  format: DiagramFormat,
  destinationInput: GenerationDestination,
) {
  const exporter = yield* DiagramExporter;
  const id = diagram.manifest.id;
  const destination = resolveDestination(id, format, destinationInput);
  const bytes = yield* exporter
    .exportArtifact(id, format)
    .pipe(
      Effect.mapError((error) =>
        preserveCreatedRecordOnExportFailure(error, id, format),
      ),
    );

  yield* Effect.gen(function* () {
    if (destination === "-") return;
    if (destinationInput._tag === "ProjectDiagrams") {
      const filesystem = yield* LocalFileSystem;
      yield* filesystem.makeDirectory(
        join(destinationInput.cwd, "diagrams"),
        true,
      );
    }
    yield* writeExportFile(destination, bytes);
  }).pipe(
    Effect.mapError((error) =>
      preserveCreatedRecordOnExportFailure(error, id, format),
    ),
  );

  return {
    id,
    format,
    destination,
    sizeBytes: bytes.byteLength,
    ...(destination === "-" ? { stdoutBytes: bytes } : {}),
  } satisfies GeneratedArtifact;
});

type PostGenerationExportFailure =
  | CliExportError
  | CliFilesystemError
  | CliStorageError;

/** Attach the already-committed record and a safe retry to every export-stage failure. */
export function preserveCreatedRecordOnExportFailure(
  error: PostGenerationExportFailure,
  diagramId: string,
  format: DiagramFormat,
): CliExportError {
  const recoveryDestination = generatedDestination(diagramId, format);
  const recoveryCommand = `sketchi export ${diagramId} --format ${format} --dest ${recoveryDestination}`;
  const details =
    error._tag === "CliExportError"
      ? error.details
      : error._tag === "CliStorageError"
        ? [`storage_error:${error.code}`]
        : [`filesystem_operation:${error.operation}`, `path:${error.path}`];
  return CliExportError.make({
    code:
      error._tag === "CliExportError"
        ? error.code
        : error._tag === "CliStorageError"
          ? "invalid_render_artifact"
          : "export_write_failed",
    diagramId,
    storagePath: `~/.sketchi/diagrams/${diagramId}`,
    recoveryCommand,
    ...(details ? { details } : {}),
    format,
    message: error.message,
    hint: `The local record is preserved. Retry with: ${recoveryCommand}`,
  });
}

export const runGenerateWorkflow = Effect.fn("sketchi.cli.generateWorkflow")(
  function* (input: GenerateWorkflowInput) {
    const generated = yield* generateDiagram(input);
    const artifact = yield* exportCreatedDiagram(
      generated.diagram,
      input.format,
      input.destination,
    );

    return {
      generated,
      artifact,
    } satisfies GenerateWorkflowResult;
  },
);
