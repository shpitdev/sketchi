import {
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer,
} from "@sketchi/diagram-agent";
import { Cause, Effect, Layer, Option } from "effect";

import { DiagramBuilder, DiagramBuilderLive } from "./builder.js";
import {
  type DiagramFormat,
  type DiagramSummary,
  type OutputFormat,
  type StoredDiagram,
  summaryFromStored,
} from "./contracts.js";
import { encodeJson, validateStorageId } from "./document.js";
import { CliFilesystemError, CliValidationError } from "./errors.js";
import { LocalFileSystem, LocalFileSystemLive } from "./filesystem.js";
import {
  Argument,
  Command,
  Flag,
  cliErrorExitCode,
  exclusiveInputSourceFlags,
  runEffectCommand,
} from "./internal/effect-unstable-cli.js";
import { InputReaderLive, readDocumentInput } from "./input.js";
import {
  CliCommandExit,
  OutputWriter,
  OutputWriterLive,
  internalErrorText,
  reportFailure,
  reportSuccess,
  runReported,
} from "./output.js";
import {
  DiagramStore,
  DiagramStoreLive,
  StorageRootLive,
  writeExportFile,
} from "./storage.js";

const ROOT_HELP = `Deterministic offline authoring for canonical Sketchi flowcharts and mindmaps.

Manual workflow (available now):
  create a canonical document, inspect or replace it, list local records, and export stored artifacts.
  Prompt-assisted generation is a later workflow and is not available in this CLI yet.

Canonical flowchart example:
  {"type":"flowchart","spec":{"id":"release-flow","title":"Release approval","nodes":[{"id":"start","label":"Change proposed","kind":"start"},{"id":"review","label":"Review evidence","kind":"process"},{"id":"end","label":"Release approved","kind":"end"}],"edges":[{"source":"start","target":"review"},{"source":"review","target":"end"}]}}

Canonical mindmap example:
  {"type":"mindmap","spec":{"id":"launch-map","title":"Launch plan","root":{"label":"Launch","children":[{"label":"Product"},{"label":"Operations"}]}}}

Input and output:
  create/edit require exactly one of --file PATH|- or --json VALUE. --file - reads one
  noninteractive UTF-8 JSON document from stdin and exits with usage code 2 on a TTY.
  --json is inline input only. Use --output text|json for result presentation.
  export writes bytes with --dest PATH|-. With --dest -, bytes use stdout and status uses stderr.

Offline boundary and storage:
  These five commands use no model, remote agent, MCP server, login, account, browser, or network.
  Records live at ~/.sketchi/diagrams/<id>/ with manifest.json, document.json, scene.json,
  diagram.excalidraw, optional diagram.png, and revisions/<revision>.json.
  Formats are scene, excalidraw, and png. PNG export only returns an already-stored PNG.

Exit codes and errors:
  0 success; 1 internal failure; 2 usage or interactive stdin; 3 invalid input/document;
  4 build/export construction failure; 5 diagram not found; 6 conflict/busy;
  7 filesystem/storage failure; 8 unavailable format or export write failure.
  Text errors start with "error: CODE". JSON errors use {"ok":false,"command":...,"error":...}.
  Errors never include stacks.

Revision recovery and next steps:
  edit validates and builds before an atomic commit, then saves the prior document under revisions/.
  To recover, inspect the prior revision JSON and pass that complete document back to edit.
  Start with create, use the returned id with show/list, then export a stored format.`;

const outputFlag = Flag.choice("output", ["text", "json"]).pipe(
  Flag.withDefault("text"),
  Flag.withDescription("Result presentation format."),
  Flag.withMetavar("text|json"),
);

const rootCommand = Command.make("sketchi").pipe(
  Command.withSharedFlags({ output: outputFlag }),
  Command.withDescription(ROOT_HELP),
  Command.withShortDescription(
    "Deterministic offline Sketchi diagram authoring.",
  ),
);

function storageLocation(id: string): string {
  return `~/.sketchi/diagrams/${id}`;
}

function revisionLocations(diagram: StoredDiagram): ReadonlyArray<string> {
  return diagram.revisions.map(
    (revision) =>
      `${storageLocation(diagram.manifest.id)}/revisions/${revision}`,
  );
}

function storedData(diagram: StoredDiagram) {
  return {
    ...summaryFromStored(diagram),
    storagePath: storageLocation(diagram.manifest.id),
    revisions: revisionLocations(diagram),
    document: diagram.document,
  };
}

function summaryText(
  action: "created" | "edited",
  diagram: StoredDiagram,
): string {
  return [
    `${action}: ${diagram.manifest.id}`,
    `type: ${diagram.manifest.type}`,
    `title: ${diagram.manifest.title}`,
    `revision: ${String(diagram.manifest.revision)}`,
    `formats: ${diagram.manifest.formats.join(",")}`,
    `storage: ${storageLocation(diagram.manifest.id)}`,
  ].join("\n");
}

function showText(diagram: StoredDiagram): string {
  const revisions = revisionLocations(diagram);
  return [
    `id: ${diagram.manifest.id}`,
    `type: ${diagram.manifest.type}`,
    `title: ${diagram.manifest.title}`,
    `revision: ${String(diagram.manifest.revision)}`,
    `formats: ${diagram.manifest.formats.join(",")}`,
    `revisions: ${revisions.length === 0 ? "none" : revisions.join(",")}`,
    "document:",
    encodeJson(diagram.document).trimEnd(),
  ].join("\n");
}

function listText(diagrams: ReadonlyArray<DiagramSummary>): string {
  if (diagrams.length === 0) return "no diagrams";
  return [
    "id\ttype\trevision\tformats\ttitle",
    ...diagrams.map((diagram) =>
      [
        diagram.id,
        diagram.type,
        String(diagram.revision),
        diagram.formats.join(","),
        diagram.title,
      ].join("\t"),
    ),
  ].join("\n");
}

const createCommand = Command.make(
  "create",
  exclusiveInputSourceFlags(),
  ({ source }) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      const builder = yield* DiagramBuilder;
      const store = yield* DiagramStore;
      const operation = Effect.gen(function* () {
        const document = yield* readDocumentInput(source);
        const built = yield* builder.build(document);
        return yield* store.create(built);
      });
      yield* runReported(
        "create",
        output,
        operation,
        (diagram) => summaryText("created", diagram),
        storedData,
      );
    }),
).pipe(
  Command.withDescription(
    "Create one local diagram from exactly one canonical document source. The document is validated and built before the record directory is committed atomically. --file - rejects an interactive TTY with exit 2.",
  ),
  Command.withExamples([
    {
      command: "sketchi create --file diagram.json",
      description: "Create from a UTF-8 JSON file.",
    },
    {
      command: "printf '%s' '{...}' | sketchi create --file - --output json",
      description: "Create from noninteractive stdin with a JSON result.",
    },
  ]),
);

const showCommand = Command.make(
  "show",
  { diagramId: Argument.string("diagram-id") },
  ({ diagramId }) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      const store = yield* DiagramStore;
      const operation = validateStorageId(diagramId).pipe(
        Effect.flatMap((id) => store.show(id)),
      );
      yield* runReported("show", output, operation, showText, storedData);
    }),
).pipe(
  Command.withDescription(
    "Show the current canonical document, manifest summary, formats, and recoverable revision paths for DIAGRAM_ID. This does not rebuild or mutate the record.",
  ),
  Command.withExamples([
    {
      command: "sketchi show release-flow --output json",
      description: "Read a record as a stable JSON envelope.",
    },
  ]),
);

const editCommand = Command.make(
  "edit",
  {
    diagramId: Argument.string("diagram-id"),
    ...exclusiveInputSourceFlags(),
  },
  ({ diagramId, source }) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      const builder = yield* DiagramBuilder;
      const store = yield* DiagramStore;
      const operation = Effect.gen(function* () {
        const id = yield* validateStorageId(diagramId);
        const document = yield* readDocumentInput(source);
        const built = yield* builder.build(document);
        if (built.id !== id) {
          return yield* CliValidationError.make({
            message: `Edited document id "${built.id}" does not match "${id}".`,
            hint: "Keep spec.id equal to the diagram id being edited.",
            details: ["spec.id"],
          });
        }
        return yield* store.edit(id, built);
      });
      yield* runReported(
        "edit",
        output,
        operation,
        (diagram) => summaryText("edited", diagram),
        storedData,
      );
    }),
).pipe(
  Command.withDescription(
    "Replace the complete canonical document for DIAGRAM_ID. Sketchi validates and builds first, preserves the prior document under revisions/, and atomically swaps the record. The new spec.id must match DIAGRAM_ID.",
  ),
  Command.withExamples([
    {
      command: "sketchi edit release-flow --file revised.json",
      description: "Replace a document and retain the prior revision.",
    },
  ]),
);

const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const { output } = yield* rootCommand;
    const store = yield* DiagramStore;
    yield* runReported("list", output, store.list(), listText);
  }),
).pipe(
  Command.withDescription(
    "List local diagrams in ascending id order with type, revision, stored formats, and title. The command is deterministic and read-only.",
  ),
  Command.withExamples([
    {
      command: "sketchi list --output json",
      description: "List records as a stable JSON envelope.",
    },
  ]),
);

interface ExportResult {
  readonly id: string;
  readonly format: DiagramFormat;
  readonly destination: string;
  readonly sizeBytes: number;
  readonly stdoutBytes?: Uint8Array;
}

function exportData(result: ExportResult) {
  return {
    id: result.id,
    format: result.format,
    destination: result.destination,
    sizeBytes: result.sizeBytes,
  };
}

const exportCommand = Command.make(
  "export",
  {
    diagramId: Argument.string("diagram-id"),
    format: Flag.choice("format", ["scene", "excalidraw", "png"]).pipe(
      Flag.withDescription("Stored artifact format to export."),
      Flag.withMetavar("scene|excalidraw|png"),
    ),
    destination: Flag.string("dest").pipe(
      Flag.withDescription("Artifact byte destination path, or - for stdout."),
      Flag.withMetavar("PATH|-"),
    ),
  },
  ({ destination, diagramId, format }) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      const store = yield* DiagramStore;
      const operation = Effect.gen(function* () {
        const id = yield* validateStorageId(diagramId);
        const bytes = yield* store.readArtifact(id, format);
        if (destination !== "-") yield* writeExportFile(destination, bytes);
        return {
          id,
          format,
          destination,
          sizeBytes: bytes.byteLength,
          ...(destination === "-" ? { stdoutBytes: bytes } : {}),
        };
      });
      yield* operation.pipe(
        Effect.matchEffect({
          onFailure: (error) => reportFailure("export", output, error),
          onSuccess: (result) =>
            Effect.gen(function* () {
              const writer = yield* OutputWriter;
              if (result.stdoutBytes) yield* writer.stdout(result.stdoutBytes);
              const data = exportData(result);
              const text = [
                `exported: ${result.id}`,
                `format: ${result.format}`,
                `destination: ${result.destination}`,
                `bytes: ${String(result.sizeBytes)}`,
              ].join("\n");
              yield* reportSuccess(
                "export",
                output,
                data,
                text,
                result.stdoutBytes ? "stderr" : "stdout",
              );
            }),
        }),
      );
    }),
).pipe(
  Command.withDescription(
    "Export one already-stored scene, Excalidraw, or PNG artifact. --dest - writes only artifact bytes to stdout and writes the text/JSON success envelope to stderr. PNG never starts a browser or network request; unavailable PNG exits 8.",
  ),
  Command.withExamples([
    {
      command:
        "sketchi export release-flow --format excalidraw --dest release.excalidraw",
      description: "Write an Excalidraw artifact atomically to a file.",
    },
    {
      command:
        "sketchi export release-flow --format scene --dest - > scene.json",
      description: "Pipe raw scene bytes without status contamination.",
    },
  ]),
);

export const sketchiCommand = rootCommand.pipe(
  Command.withSubcommands([
    createCommand,
    showCommand,
    editCommand,
    listCommand,
    exportCommand,
  ]),
);

function requestedOutput(args: ReadonlyArray<string>): OutputFormat {
  const index = args.lastIndexOf("--output");
  if (index >= 0 && args[index + 1] === "json") return "json";
  return args.some((arg) => arg === "--output=json") ? "json" : "text";
}

export const cliProgram = Effect.fn("sketchi.cli.run")(function* (
  args: ReadonlyArray<string>,
) {
  const format = requestedOutput(args);
  return yield* runEffectCommand(sketchiCommand, args).pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) =>
        Effect.gen(function* () {
          const failure = Option.getOrUndefined(Cause.findErrorOption(cause));
          if (failure instanceof CliCommandExit) return failure.exitCode;
          if (failure instanceof CliFilesystemError) return 7;
          const parserExit = cliErrorExitCode(failure);
          if (parserExit !== undefined) return parserExit;
          const writer = yield* OutputWriter;
          yield* writer
            .stderr(internalErrorText(format))
            .pipe(Effect.catch(() => Effect.void));
          return 1;
        }),
      onSuccess: () => Effect.succeed(0),
    }),
  );
});

const codeModeDependencies = Layer.mergeAll(
  CodeModeArtifactStorageMemory,
  makeCodeModeRuntimeEnvironmentLayer({
    createId: (prefix) => `${prefix}_offline_cli`,
  }),
);
const diagramBuilderLayer = Layer.provide(
  DiagramBuilderLive,
  codeModeDependencies,
);
const storageDependencies = Layer.mergeAll(
  LocalFileSystemLive,
  StorageRootLive,
);
const diagramStoreLayer = Layer.provide(DiagramStoreLive, storageDependencies);

export const CliApplicationLayer = Layer.mergeAll(
  LocalFileSystemLive,
  StorageRootLive,
  diagramBuilderLayer,
  diagramStoreLayer,
  InputReaderLive.pipe(Layer.provide(LocalFileSystemLive)),
  OutputWriterLive,
);
