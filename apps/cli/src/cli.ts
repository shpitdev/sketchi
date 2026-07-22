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
import { DiagramExporter, DiagramExporterLive } from "./exporter.js";
import { LocalFileSystem, LocalFileSystemLive } from "./filesystem.js";
import {
  DEFAULT_GENERATE_ENDPOINT,
  DEFAULT_GENERATION_MODEL,
  SKETCHI_GENERATE_ENDPOINT_ENV,
  generateDiagram,
  resolveGenerateEndpoint,
  type GenerateDiagramResult,
} from "./generation.js";
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
import { CliPngRendererLive } from "./png-renderer.js";
import {
  DiagramStore,
  DiagramStoreLive,
  StorageRootLive,
  writeExportFile,
} from "./storage.js";

const ROOT_HELP = `Local Sketchi authoring for canonical flowcharts and mindmaps, with one prompt-assisted path.

Manual JSON workflow (strictly offline):
  create a canonical document, inspect or replace it, list local records, and export stored artifacts.
  Accepted input is exactly one complete JSON object shaped like an example below.

Canonical flowchart example:
  {"type":"flowchart","spec":{"id":"release-flow","title":"Release approval","nodes":[{"id":"start","label":"Change proposed","kind":"start"},{"id":"review","label":"Review evidence","kind":"process"},{"id":"end","label":"Release approved","kind":"end"}],"edges":[{"source":"start","target":"review"},{"source":"review","target":"end"}]}}

Canonical mindmap example:
  {"type":"mindmap","spec":{"id":"launch-map","title":"Launch plan","root":{"label":"Launch","children":[{"label":"Product"},{"label":"Operations"}]}}}

Prompt-assisted workflow (sole network boundary):
  sketchi generate --prompt TEXT [--type flowchart|mindmap] [--model MODEL]
  Only generate uses the network. It makes one unauthenticated HTTPS POST to the public
  Sketchi generate API at ${DEFAULT_GENERATE_ENDPOINT}
  and needs no token, key, account, or login. The model call, validation, and quality gate
  run server-side; the finished diagram and Excalidraw artifact come back and are committed
  through the same local store as create. The default type is flowchart and default model is
  ${DEFAULT_GENERATION_MODEL}. Override the endpoint for preview or local testing with
  ${SKETCHI_GENERATE_ENDPOINT_ENV} or --endpoint URL.

Input and output contracts:
  create/edit require exactly one of --file PATH|- or --json VALUE. --file - reads one
  noninteractive UTF-8 JSON document from stdin and exits with usage code 2 on a TTY.
  --json is inline input only. --prompt is noninteractive text. Use --output text|json for
  result presentation on every command.
  export writes bytes with --dest PATH|- and always writes status to stderr. With --dest -,
  stdout contains only artifact bytes. A successful PNG file export adds a generic inline-Markdown
  display hint for calling agents.

Offline boundary and storage:
  create, show, edit, list, and export use no model, remote agent, MCP server, login,
  account, browser, credential, or network. No command sends stored records to a provider.
  Records live at ~/.sketchi/diagrams/<id>/ with manifest.json, document.json, scene.json,
  diagram.excalidraw, optional diagram.png, and revisions/<revision>.json.
  Formats are scene, excalidraw, and png. If no PNG is stored, export deterministically renders one
  on demand from the local scene and Excalidraw artifacts, without a browser, network, or record write.

Exit codes and errors:
  0 success; 1 internal failure; 2 usage or interactive stdin; 3 invalid input/document;
  4 build/export construction failure; 5 diagram not found; 6 conflict/busy;
  7 filesystem/storage failure; 8 unavailable format or export write failure;
  10 generate network/endpoint failure; 11 generate timeout; 12 malformed generate output.
  Text errors start with "error: CODE". JSON errors use {"ok":false,"command":...,"error":...}.
  Errors never include stacks.

Revision recovery and next steps:
  edit validates and builds before an atomic commit, then saves the prior document under revisions/.
  To recover, inspect the prior revision JSON and pass that complete document back to edit.
  Start with create for accepted JSON or generate for a prompt. Use the returned id with show/list,
  edit with a complete replacement document, then export a stored scene or Excalidraw artifact.`;

const outputFlag = Flag.choice("output", ["text", "json"]).pipe(
  Flag.withDefault("text"),
  Flag.withDescription("Result presentation format."),
  Flag.withMetavar("text|json"),
);

const rootCommand = Command.make("sketchi").pipe(
  Command.withSharedFlags({ output: outputFlag }),
  Command.withDescription(ROOT_HELP),
  Command.withShortDescription(
    "Local Sketchi authoring with one credential-free prompt-assisted command.",
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

function generatedData(result: GenerateDiagramResult) {
  return {
    ...storedData(result.diagram),
    generation: { model: result.model, provider: result.provider },
  };
}

function generatedText(result: GenerateDiagramResult): string {
  return [
    summaryText("created", result.diagram).replace(/^created:/u, "generated:"),
    `provider: ${result.provider}`,
    `model: ${result.model}`,
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

const GENERATE_HELP = `Create one persisted diagram from --prompt TEXT. This is Sketchi's only command that uses the network. It makes one unauthenticated HTTPS POST to the public Sketchi generate API and needs no token, key, account, or login.

Network and options:
  Endpoint: ${DEFAULT_GENERATE_ENDPOINT}
  The model call, schema validation, and quality gate run server-side; the finished diagram
  and Excalidraw artifact are returned over plain HTTPS. Sketchi sends no credentials.
  --type defaults to flowchart; --model defaults to ${DEFAULT_GENERATION_MODEL}.
  Override the endpoint for preview or local testing with ${SKETCHI_GENERATE_ENDPOINT_ENV}
  or --endpoint URL. --output text|json controls only the local result envelope.

Validation and storage:
  The returned diagram is decoded against Sketchi's canonical package schemas and atomically
  committed through the create store at ~/.sketchi/diagrams/<id>/. The record contains
  manifest.json, document.json, scene.json, and diagram.excalidraw.
  Any network/endpoint/timeout/output/validation/storage failure leaves no visible record.

Errors and next steps:
  Exit 10 means a network or endpoint failure, 11 a timeout, and 12 malformed output;
  a rejected or invalid generated document uses 3, conflict uses 6, and storage uses 7.
  On success, pass the returned id to show, edit, list, or export. For strictly offline manual
  authoring and accepted canonical JSON examples, run sketchi --help.`;

const generateCommand = Command.make(
  "generate",
  {
    prompt: Flag.string("prompt").pipe(
      Flag.withDescription(
        "Diagram request text sent to the public Sketchi generate API.",
      ),
      Flag.withMetavar("TEXT"),
    ),
    type: Flag.choice("type", ["flowchart", "mindmap"]).pipe(
      Flag.withDefault("flowchart"),
      Flag.withDescription(
        "Requested canonical diagram type; default flowchart.",
      ),
      Flag.withMetavar("flowchart|mindmap"),
    ),
    model: Flag.string("model").pipe(
      Flag.withDefault(DEFAULT_GENERATION_MODEL),
      Flag.withDescription(
        `Server-routed generation model id; default ${DEFAULT_GENERATION_MODEL}.`,
      ),
      Flag.withMetavar("MODEL"),
    ),
    endpoint: Flag.string("endpoint").pipe(
      Flag.withDefault(resolveGenerateEndpoint()),
      Flag.withDescription(
        "Unauthenticated generate API URL; defaults to the production Sketchi endpoint.",
      ),
      Flag.withMetavar("URL"),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      yield* runReported(
        "generate",
        output,
        generateDiagram(input),
        generatedText,
        generatedData,
      );
    }),
).pipe(
  Command.withDescription(GENERATE_HELP),
  Command.withShortDescription(
    "Generate and persist one diagram through the public unauthenticated Sketchi generate API.",
  ),
  Command.withExamples([
    {
      command:
        'sketchi generate --prompt "Map release approval with pass and revise branches"',
      description: `Generate a flowchart with ${DEFAULT_GENERATION_MODEL}.`,
    },
    {
      command:
        'sketchi generate --prompt "Organize launch readiness" --type mindmap --model gemini-3.1-flash-lite --output json',
      description: "Generate and persist a mindmap with structured output.",
    },
  ]),
);

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
  const hint = displayHint(result);
  return {
    id: result.id,
    format: result.format,
    destination: result.destination,
    sizeBytes: result.sizeBytes,
    ...(hint ? { hint } : {}),
  };
}

function displayHint(result: ExportResult): string | undefined {
  return result.format === "png" && result.destination !== "-"
    ? `to show this diagram to the user, display the exported file as an inline markdown image, e.g. ![${result.id}](${result.destination})`
    : undefined;
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
      const exporter = yield* DiagramExporter;
      const operation = Effect.gen(function* () {
        const id = yield* validateStorageId(diagramId);
        const bytes = yield* exporter.exportArtifact(id, format);
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
              const hint = displayHint(result);
              const text = [
                `exported: ${result.id}`,
                `format: ${result.format}`,
                `destination: ${result.destination}`,
                `bytes: ${String(result.sizeBytes)}`,
                ...(hint ? [`hint: ${hint}`] : []),
              ].join("\n");
              yield* reportSuccess("export", output, data, text, "stderr");
            }),
        }),
      );
    }),
).pipe(
  Command.withDescription(
    "Export a stored scene or Excalidraw artifact, or render PNG on demand from both when no PNG is stored. Rendering is deterministic, export-only, and uses bundled fonts plus a WASM rasterizer: it never starts a browser or network request and never writes the PNG back to the record. Status always uses stderr, so --dest - leaves stdout byte-only. A successful PNG file export adds a generic inline-Markdown display hint for calling agents. Render or write failures exit 8.",
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
    generateCommand,
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
const diagramExporterLayer = Layer.provide(
  DiagramExporterLive,
  Layer.mergeAll(diagramStoreLayer, CliPngRendererLive),
);

export const CliApplicationLayer = Layer.mergeAll(
  LocalFileSystemLive,
  StorageRootLive,
  diagramBuilderLayer,
  diagramStoreLayer,
  diagramExporterLayer,
  InputReaderLive.pipe(Layer.provide(LocalFileSystemLive)),
  OutputWriterLive,
);
