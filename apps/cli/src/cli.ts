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
import {
  CliFilesystemError,
  CliShareError,
  CliValidationError,
} from "./errors.js";
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
  exactlyOnceStringFlag,
  exclusiveInputSourceFlags,
  runEffectCommand,
} from "./internal/effect-unstable-cli.js";
import {
  InputReader,
  InputReaderLive,
  readDocumentInput,
  readPatchInput,
} from "./input.js";
import {
  CliCommandExit,
  OutputWriter,
  OutputWriterLive,
  internalErrorText,
  reportFailure,
  reportSuccess,
  runReported,
} from "./output.js";
import { CliPngRenderer, CliPngRendererLive } from "./png-renderer.js";
import { DiagramPatcher, DiagramPatcherLive } from "./patch.js";
import { preflightPullTarget, pullIntoStore } from "./pull.js";
import {
  MAX_RENDER_CANVAS_AREA,
  MAX_RENDER_CANVAS_DIMENSION,
  MAX_RENDER_ELEMENT_DIMENSION,
  MAX_RENDER_OUTPUT_PIXELS,
} from "./render-limits.js";
import {
  ExcalidrawShare,
  ExcalidrawShareLive,
  LinkOpener,
  LinkOpenerLive,
  ShareTransportLive,
  type OpenResult,
} from "./share.js";
import { MAX_SHARE_LINK_LENGTH } from "./share-protocol.js";
import {
  DiagramStore,
  DiagramStoreLive,
  StorageRootLive,
  writeExportFile,
} from "./storage.js";

const AGENT_DOCS = `Sketchi CLI contracts for agents and automation.

Manual JSON workflow (strictly offline):
  create a canonical document, apply semantic patches, inspect or replace it, list local records,
  and export stored artifacts.
  Accepted input is exactly one complete JSON object shaped like an example below.

Canonical flowchart example:
  {"type":"flowchart","spec":{"id":"release-flow","title":"Release approval","nodes":[{"id":"start","label":"Change proposed","kind":"start"},{"id":"review","label":"Review evidence","kind":"process"},{"id":"end","label":"Release approved","kind":"end"}],"edges":[{"source":"start","target":"review"},{"source":"review","target":"end"}]}}

Canonical mindmap example:
  {"type":"mindmap","spec":{"id":"launch-map","title":"Launch plan","root":{"label":"Launch","children":[{"label":"Product"},{"label":"Operations"}]}}}

Semantic color patch example:
  sketchi patch release-flow --json '{"operations":[{"op":"setStyle","selector":{"nodeIds":["review","approve"]},"style":{"fillColor":"#dbeafe","strokeColor":"#2563eb","textColor":"#1e3a8a"}}]}'

Explicit network commands (one credential-free HTTPS request each):
  sketchi generate --prompt TEXT [--type flowchart|mindmap] [--model MODEL]
  sketchi share DIAGRAM_ID [--open]
  sketchi pull DIAGRAM_ID --link URL|-
  generate makes one unauthenticated HTTPS POST to the public Sketchi generate API at ${DEFAULT_GENERATE_ENDPOINT}
  and needs no token, key, account, or login. The model call, validation, and quality gate
  run server-side; the finished diagram and Excalidraw artifact come back and are committed
  through the same local store as create. The default type is flowchart and default model is
  ${DEFAULT_GENERATION_MODEL}. Override the endpoint for preview or local testing with
  ${SKETCHI_GENERATE_ENDPOINT_ENV} or --endpoint URL.

Input and output contracts:
  create/edit/patch require exactly one of --file PATH|- or --json VALUE. --file - reads one
  noninteractive UTF-8 JSON document from stdin and exits with usage code 2 on a TTY.
  --json is inline input only. --prompt is noninteractive text. generate exports PNG to
  <generated-id>.png by default; --format scene|excalidraw selects another artifact and --dest
  PATH|- overrides its destination. Use --output text|json for result presentation on every command.
  export writes bytes with --dest PATH|- and always writes status to stderr. With --dest -,
  stdout contains only artifact bytes. A successful PNG file export adds a generic inline-Markdown
  display hint for calling agents.

Share/pull safety limits:
  links 4 KiB; encrypted bodies 2 MiB; inflated contents 16 MiB; 10,000 elements;
  JSON depth 64; element dimensions ${String(MAX_RENDER_ELEMENT_DIMENSION)}; canvas dimensions
  ${String(MAX_RENDER_CANVAS_DIMENSION)}; canvas area ${String(MAX_RENDER_CANVAS_AREA)} square units; final PNG
  ${String(MAX_RENDER_OUTPUT_PIXELS)} pixels. Limits are checked before encryption or raster allocation.

Offline boundary and storage:
  create, patch, show, edit, list, export, and restore use no model, remote agent, MCP server, login,
  account, browser, credential, or network. share sends only locally encrypted ciphertext from
  the selected record to Excalidraw storage; pull sends only the link id in its download request.
  Records live at ~/.sketchi/diagrams/<id>/ with manifest.json, document.json, scene.json,
  diagram.excalidraw, optional diagram.png, and revisions/. New revisions are full snapshots
  under revisions/<revision>/; legacy document-only revisions/<revision>.json remain readable.
  A pulled record is detached: diagram.excalidraw is authoritative while document.json and
  scene.json remain non-authoritative provenance. A patched record makes scene.json authoritative
  while retaining document.json as provenance. show/list expose these states; edit refuses both.
  Formats are scene, excalidraw, and png. generate persists the canonical record before exporting
  the requested artifact; a later destination failure leaves that record recoverable. If no PNG is
  stored, export deterministically renders one on demand from the local scene and Excalidraw artifacts,
  without a browser, network, or record write.

Exit codes and errors:
  0 success; 1 internal failure; 2 usage or interactive stdin; 3 invalid input/document;
  4 build/export construction failure; 5 diagram not found; 6 conflict/busy;
  7 filesystem/storage failure; 8 unavailable format, render, destination, or write failure;
  10 generate network/endpoint failure; 11 generate timeout; 12 malformed generate output;
  13 Excalidraw transport, timeout, HTTP, or API-shape failure.
  Text errors start with "error: CODE". JSON errors use {"ok":false,"command":...,"error":...}.
  Errors never include stacks.

Revision recovery and next steps:
  edit, pull, and restore archive the complete prior authority state before atomic replacement.
  Use restore --revision N to recover through the CLI without consuming the selected snapshot.
  Start with generate for a prompt or create for accepted JSON. Use the returned id with show/list,
  edit with a complete replacement document, then export another stored artifact when needed.`;

const HUMAN_HELP = `Describe a diagram and get a validated PNG plus an editable local record.

Start here:
  sketchi generate --prompt "Map our release approval flow"

The PNG is written to <generated-id>.png in the current directory. Use --format or --dest to
choose another artifact or destination. Run sketchi docs for complete agent and automation contracts.`;

const outputFlag = Flag.choice("output", ["text", "json"]).pipe(
  Flag.withDefault("text"),
  Flag.withDescription("Result presentation format."),
  Flag.withMetavar("text|json"),
);

const rootCommand = Command.make("sketchi").pipe(
  Command.withSharedFlags({ output: outputFlag }),
  Command.withDescription(HUMAN_HELP),
  Command.withShortDescription(
    "Turn a prompt into a validated PNG and editable local diagram.",
  ),
);

const docsCommand = Command.make("docs", {}, () =>
  Effect.gen(function* () {
    const { output } = yield* rootCommand;
    yield* reportSuccess(
      "docs",
      output,
      { documentation: AGENT_DOCS },
      AGENT_DOCS,
    );
  }),
).pipe(
  Command.withDescription(
    "Print the complete CLI contracts for agents, automation, storage, formats, safety limits, and errors.",
  ),
  Command.withShortDescription(
    "Print complete agent and automation documentation.",
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

const SHARE_HINT =
  "this immutable link is a bearer snapshot: anyone with the full URL can decrypt it, so share it only with the intended user. Browser edits do not update this link; after editing, choose Save to… → Export to Link and return the new link for sketchi pull.";

function unsupportedPulledScene() {
  return CliShareError.make({
    code: "unsupported_scene",
    message:
      "The linked Excalidraw scene cannot be rendered by this Sketchi CLI.",
    hint: "Use only the supported v1 elements and Excalifont text, then export a new link.",
    details: [],
  });
}

const readLinkInput = Effect.fn("sketchi.cli.pull.readLink")(function* (
  link: string,
) {
  if (link !== "-") return link;
  const reader = yield* InputReader;
  return (yield* reader.read(
    { _tag: "File", path: "-" },
    { content: "share link", maxBytes: MAX_SHARE_LINK_LENGTH },
  )).trim();
});

function summaryText(
  action: "created" | "edited" | "patched",
  diagram: StoredDiagram,
): string {
  return [
    `${action}: ${diagram.manifest.id}`,
    `type: ${diagram.manifest.type}`,
    `title: ${diagram.manifest.title}`,
    `revision: ${String(diagram.manifest.revision)}`,
    `authority: ${diagram.authority}`,
    `document authoritative: ${String(diagram.documentAuthoritative)}`,
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

interface GenerateCommandResult {
  readonly generated: GenerateDiagramResult;
  readonly artifact: ExportResult;
}

function generatedArtifactData(result: GenerateCommandResult) {
  return {
    ...generatedData(result.generated),
    export: exportData(result.artifact),
  };
}

function generatedArtifactText(result: GenerateCommandResult): string {
  const hint = displayHint(result.artifact);
  return [
    generatedText(result.generated),
    `format: ${result.artifact.format}`,
    `destination: ${result.artifact.destination}`,
    `bytes: ${String(result.artifact.sizeBytes)}`,
    ...(hint ? [`hint: ${hint}`] : []),
  ].join("\n");
}

function generatedDestination(id: string, format: DiagramFormat): string {
  switch (format) {
    case "png":
      return `${id}.png`;
    case "excalidraw":
      return `${id}.excalidraw`;
    case "scene":
      return `${id}.scene.json`;
  }
}

function showText(diagram: StoredDiagram): string {
  const revisions = revisionLocations(diagram);
  return [
    `id: ${diagram.manifest.id}`,
    `type: ${diagram.manifest.type}`,
    `title: ${diagram.manifest.title}`,
    `revision: ${String(diagram.manifest.revision)}`,
    `authority: ${diagram.authority}`,
    `document authoritative: ${String(diagram.documentAuthoritative)}`,
    `formats: ${diagram.manifest.formats.join(",")}`,
    `revisions: ${revisions.length === 0 ? "none" : revisions.join(",")}`,
    "document:",
    encodeJson(diagram.document).trimEnd(),
  ].join("\n");
}

function listText(diagrams: ReadonlyArray<DiagramSummary>): string {
  if (diagrams.length === 0) return "no diagrams";
  return [
    "id\ttype\trevision\tauthority\tdocument-authoritative\tformats\ttitle",
    ...diagrams.map((diagram) =>
      [
        diagram.id,
        diagram.type,
        String(diagram.revision),
        diagram.authority,
        String(diagram.documentAuthoritative),
        diagram.formats.join(","),
        diagram.title,
      ].join("\t"),
    ),
  ].join("\n");
}

const GENERATE_HELP = `Create one persisted diagram from --prompt TEXT and export its PNG by default. This is one of Sketchi's three explicit network commands (generate, share, pull). It makes one unauthenticated HTTPS POST to the public Sketchi generate API and needs no token, key, account, or login.

Network and options:
  Endpoint: ${DEFAULT_GENERATE_ENDPOINT}
  The model call, schema validation, and quality gate run server-side; the finished diagram
  and Excalidraw artifact are returned over plain HTTPS. Sketchi sends no credentials.
  --type defaults to flowchart; --model defaults to ${DEFAULT_GENERATION_MODEL}.
  Override the endpoint for preview or local testing with ${SKETCHI_GENERATE_ENDPOINT_ENV}
  or --endpoint URL. --format defaults to png. Without --dest, the artifact is written as
  <generated-id>.png, <generated-id>.excalidraw, or <generated-id>.scene.json in the current
  directory. --dest PATH|- overrides that path. --output text|json controls only the status envelope.

Validation and storage:
  The returned diagram is decoded against Sketchi's canonical package schemas and atomically
  committed through the create store at ~/.sketchi/diagrams/<id>/. The record contains
  manifest.json, document.json, scene.json, and diagram.excalidraw. PNG rendering remains lazy
  and is not written back to that record. Network/endpoint/timeout/output/validation/storage
  failures leave no visible record; a later export destination failure leaves the created record.

Errors and next steps:
  Exit 10 means a network or endpoint failure, 11 a timeout, and 12 malformed output;
  a rejected or invalid generated document uses 3, conflict uses 6, and storage uses 7.
  With --dest -, stdout contains artifact bytes only and all status uses stderr. On success, pass
  the returned id to show, edit, list, or export. For strictly offline manual authoring, accepted
  canonical JSON examples, and full error contracts, run sketchi docs.`;

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
    format: Flag.choice("format", ["png", "excalidraw", "scene"]).pipe(
      Flag.withDefault("png"),
      Flag.withDescription("Artifact exported after generation; default png."),
      Flag.withMetavar("png|excalidraw|scene"),
    ),
    destination: Flag.optional(
      Flag.string("dest").pipe(
        Flag.withDescription(
          "Artifact destination; defaults from the generated id, or - for stdout.",
        ),
        Flag.withMetavar("PATH|-"),
      ),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      const exporter = yield* DiagramExporter;
      const operation = Effect.gen(function* () {
        const generated = yield* generateDiagram(input);
        const destination = Option.getOrElse(input.destination, () =>
          generatedDestination(generated.diagram.manifest.id, input.format),
        );
        const bytes = yield* exporter.exportArtifact(
          generated.diagram.manifest.id,
          input.format,
        );
        if (destination !== "-") yield* writeExportFile(destination, bytes);
        return {
          generated,
          artifact: {
            id: generated.diagram.manifest.id,
            format: input.format,
            destination,
            sizeBytes: bytes.byteLength,
            ...(destination === "-" ? { stdoutBytes: bytes } : {}),
          },
        };
      });
      yield* operation.pipe(
        Effect.matchEffect({
          onFailure: (error) => reportFailure("generate", output, error),
          onSuccess: (result) =>
            Effect.gen(function* () {
              const writer = yield* OutputWriter;
              if (result.artifact.stdoutBytes) {
                yield* writer.stdout(result.artifact.stdoutBytes);
              }
              yield* reportSuccess(
                "generate",
                output,
                generatedArtifactData(result),
                generatedArtifactText(result),
                result.artifact.destination === "-" ? "stderr" : "stdout",
              );
            }),
        }),
      );
    }),
).pipe(
  Command.withDescription(GENERATE_HELP),
  Command.withShortDescription(
    "Generate, persist, and export a PNG from one prompt.",
  ),
  Command.withExamples([
    {
      command:
        'sketchi generate --prompt "Map release approval with pass and revise branches"',
      description: `Generate a flowchart with ${DEFAULT_GENERATION_MODEL} and write its PNG.`,
    },
    {
      command:
        'sketchi generate --prompt "Organize launch readiness" --type mindmap --format excalidraw --dest launch.excalidraw --output json',
      description: "Generate a mindmap and write editable Excalidraw.",
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
  Command.withShortDescription("Create a local diagram from canonical JSON."),
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
    "Show current authority, documentAuthoritative state, retained document provenance, manifest formats, and recoverable revision paths for DIAGRAM_ID. This is strictly offline and does not rebuild or mutate the record.",
  ),
  Command.withShortDescription("Inspect one local diagram."),
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
    "Replace the complete canonical document for DIAGRAM_ID. Sketchi validates and builds first, preserves the prior full authority state under revisions/, and atomically swaps the record. Patched and detached records refuse edit because their canonical document is no longer authoritative. The new spec.id must match DIAGRAM_ID.",
  ),
  Command.withShortDescription("Replace a canonical diagram document."),
  Command.withExamples([
    {
      command: "sketchi edit release-flow --file revised.json",
      description: "Replace a document and retain the prior revision.",
    },
  ]),
);

const patchCommand = Command.make(
  "patch",
  {
    diagramId: Argument.string("diagram-id"),
    ...exclusiveInputSourceFlags("patch request"),
  },
  ({ diagramId, source }) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      const patcher = yield* DiagramPatcher;
      const store = yield* DiagramStore;
      const operation = Effect.gen(function* () {
        const id = yield* validateStorageId(diagramId);
        const input = yield* readPatchInput(source);
        const current = yield* store.readPatchSource(id);
        const artifacts = yield* patcher.patch(
          current.scene,
          input,
          `cli-patch-${id}-${String(current.revision + 1)}`,
        );
        return yield* store.commitPatch(id, current.revision, artifacts);
      });
      yield* runReported(
        "patch",
        output,
        operation,
        (diagram) => summaryText("patched", diagram),
        storedData,
      );
    }),
).pipe(
  Command.withDescription(
    "Apply Sketchi semantic setStyle, setDefaultStyle, setShape, translate, replaceText, or rerouteEdges operations to the current stored scene. The CLI owns source and requestId; input contains operations plus optional options or intent. The prior full revision is recoverable, document.json remains unchanged provenance, stale stored PNG is removed, and the patched scene becomes authoritative. This command is strictly offline. Edit remains blocked until a canonical revision is restored.",
  ),
  Command.withShortDescription("Apply semantic edits to a stored diagram."),
  Command.withExamples([
    {
      command:
        'sketchi patch release-flow --json \'{"operations":[{"op":"setStyle","selector":{"nodeIds":["review","approve"]},"style":{"fillColor":"#dbeafe","strokeColor":"#2563eb","textColor":"#1e3a8a"}}]}\'',
      description: "Color selected nodes through semantic ids.",
    },
    {
      command: "sketchi patch release-flow --file patch.json --output json",
      description:
        "Patch from a file, then export or restore the reported diagram revision.",
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
    "List local diagrams in ascending id order with type, revision, authority, documentAuthoritative, current stored formats, and retained title provenance. The command is deterministic, strictly offline, and read-only.",
  ),
  Command.withShortDescription("List local diagrams."),
  Command.withExamples([
    {
      command: "sketchi list --output json",
      description: "List records as a stable JSON envelope.",
    },
  ]),
);

interface ShareResult {
  readonly id: string;
  readonly link: string;
  readonly open: OpenResult;
  readonly hint: string;
}

const shareCommand = Command.make(
  "share",
  {
    diagramId: Argument.string("diagram-id"),
    open: Flag.boolean("open").pipe(
      Flag.withDescription(
        "Hand the bearer link to the default OS browser opener.",
      ),
    ),
  },
  ({ diagramId, open }) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      const store = yield* DiagramStore;
      const sharing = yield* ExcalidrawShare;
      const opener = yield* LinkOpener;
      const operation = Effect.gen(function* () {
        const id = yield* validateStorageId(diagramId);
        const source = yield* store.readExportSource(id, "excalidraw");
        if (source._tag !== "StoredArtifact") {
          return yield* CliShareError.make({
            code: "unsupported_scene",
            message: `Diagram "${id}" has no authoritative Excalidraw artifact.`,
            hint: "Restore or rebuild the diagram before sharing it.",
            details: [],
          });
        }
        const artifact: unknown = yield* Effect.try({
          try: () => JSON.parse(new TextDecoder().decode(source.bytes)),
          catch: unsupportedPulledScene,
        });
        const result = yield* sharing.share(artifact);
        const openResult = open
          ? yield* opener.open(result.link)
          : { status: "not_requested" as const };
        return { id, link: result.link, open: openResult, hint: SHARE_HINT };
      });
      yield* operation.pipe(
        Effect.matchEffect({
          onFailure: (error) => reportFailure("share", output, error),
          onSuccess: (result) =>
            Effect.gen(function* () {
              yield* reportSuccess(
                "share",
                output,
                result,
                [
                  `shared: ${result.id}`,
                  `link: ${result.link}`,
                  `open: ${result.open.status}`,
                  `hint: ${result.hint}`,
                ].join("\n"),
              );
              if (output === "text" && result.open.status === "unconfirmed") {
                const writer = yield* OutputWriter;
                yield* writer.stderr(
                  "notice: the OS browser opener could not be confirmed; the share link is still valid.\n",
                );
              }
            }),
        }),
      );
    }),
).pipe(
  Command.withDescription(
    `Encrypt and upload the current authoritative Excalidraw artifact as one immutable excalidraw.com bearer snapshot. This makes exactly one credential-free HTTPS request. The storage service can observe connection metadata, timing, and ciphertext size; retention is uncontrolled, and Sketchi cannot revoke or delete a link. Anyone with the full URL can decrypt it. Supported elements: rectangle, ellipse, diamond, arrow, line, freedraw, text; text must use Excalifont fontFamily 5; files and images are rejected. Render limits: element dimension ${String(MAX_RENDER_ELEMENT_DIMENSION)}, canvas dimension ${String(MAX_RENDER_CANVAS_DIMENSION)}, canvas area ${String(MAX_RENDER_CANVAS_AREA)}, final PNG pixels ${String(MAX_RENDER_OUTPUT_PIXELS)}. --open is opt-in and only confirms whether the OS accepted the request.`,
  ),
  Command.withShortDescription("Share an encrypted Excalidraw snapshot."),
);

const pullCommand = Command.make(
  "pull",
  {
    diagramId: Argument.string("diagram-id"),
    link: exactlyOnceStringFlag(
      "link",
      "URL|-",
      "Excalidraw bearer share URL, or - for noninteractive stdin.",
    ),
  },
  ({ diagramId, link }) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      const operation = Effect.gen(function* () {
        const target = yield* preflightPullTarget(diagramId);
        const suppliedLink = yield* readLinkInput(link);
        return yield* pullIntoStore(diagramId, suppliedLink, target);
      });
      yield* runReported(
        "pull",
        output,
        operation,
        ({ diagram }) =>
          [
            `pulled: ${diagram.manifest.id}`,
            `revision: ${String(diagram.manifest.revision)}`,
            `authority: ${diagram.authority}`,
            "source identity: unverified",
          ].join("\n"),
        ({ diagram, sourceIdentity }) => ({
          id: diagram.manifest.id,
          revision: diagram.manifest.revision,
          authority: diagram.authority,
          documentAuthoritative: diagram.documentAuthoritative,
          formats: diagram.manifest.formats,
          revisions: revisionLocations(diagram),
          sourceIdentity,
        }),
      );
    }),
).pipe(
  Command.withDescription(
    `Fetch exactly one current-format excalidraw.com bearer snapshot, decrypt it locally, restore and strictly validate it, prove detached PNG renderability, then atomically preserve the prior full record and replace diagram.excalidraw as detached authority. The link carries no trusted Sketchi identity and may be unrelated to DIAGRAM_ID. This makes exactly one credential-free HTTPS request and never echoes or stores the input link or key. Supported elements: rectangle, ellipse, diamond, arrow, line, freedraw, text; text must use Excalifont fontFamily 5; files, images, external resources, and other fonts are rejected. Render limits: element dimension ${String(MAX_RENDER_ELEMENT_DIMENSION)}, canvas dimension ${String(MAX_RENDER_CANVAS_DIMENSION)}, canvas area ${String(MAX_RENDER_CANVAS_AREA)}, final PNG pixels ${String(MAX_RENDER_OUTPUT_PIXELS)}.`,
  ),
  Command.withShortDescription("Pull browser edits from an Excalidraw link."),
);

const restoreCommand = Command.make(
  "restore",
  {
    diagramId: Argument.string("diagram-id"),
    revision: Flag.integer("revision").pipe(
      Flag.filter(
        (revision) => revision > 0,
        (revision) => `Expected a positive revision, got ${String(revision)}`,
      ),
      Flag.withMetavar("N"),
      Flag.withDescription(
        "Archived revision number to restore without consuming it.",
      ),
    ),
  },
  ({ diagramId, revision }) =>
    Effect.gen(function* () {
      const { output } = yield* rootCommand;
      const store = yield* DiagramStore;
      const builder = yield* DiagramBuilder;
      const operation = Effect.gen(function* () {
        const id = yield* validateStorageId(diagramId);
        const selected = yield* store.readRevision(id, revision);
        const restored =
          selected._tag === "LegacyDocument"
            ? yield* builder
                .build(selected.document)
                .pipe(
                  Effect.flatMap((built) => store.restore(id, revision, built)),
                )
            : yield* store.restore(id, revision);
        return restored;
      });
      yield* runReported(
        "restore",
        output,
        operation,
        (result) =>
          [
            `restored: ${result.diagram.manifest.id}`,
            `from revision: ${String(result.restoredFromRevision)}`,
            `revision: ${String(result.diagram.manifest.revision)}`,
            `authority: ${result.diagram.authority}`,
          ].join("\n"),
        (result) => ({
          id: result.diagram.manifest.id,
          restoredFromRevision: result.restoredFromRevision,
          revision: result.diagram.manifest.revision,
          authority: result.diagram.authority,
          documentAuthoritative: result.diagram.documentAuthoritative,
          formats: result.diagram.manifest.formats,
          revisions: revisionLocations(result.diagram),
        }),
      );
    }),
).pipe(
  Command.withDescription(
    "Strictly offline recovery. Archive the current full state first, then restore revision N byte-for-byte without consuming it and commit at the next monotonic revision. Full snapshots restore artifacts and authority without rebuilding; legacy document-only revisions rebuild only while the record remains canonical.",
  ),
  Command.withShortDescription("Restore a retained diagram revision."),
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

const exportCommand = Command.make(
  "export",
  {
    diagramId: Argument.string("diagram-id"),
    format: Flag.choice("format", ["scene", "excalidraw", "png"]).pipe(
      Flag.withDescription("Artifact format to export or render on demand."),
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
    "Strictly offline export of a current stored artifact or on-demand PNG. Canonical PNG uses scene plus Excalidraw; detached PNG restores diagram.excalidraw directly, uses its viewBackgroundColor, and adds no stale canonical title. Detached scene export is unavailable. Rendering never starts a browser or network request and never writes the PNG back. Status always uses stderr, so --dest - leaves stdout byte-only. Render or write failures exit 8.",
  ),
  Command.withShortDescription("Export scene, Excalidraw, or PNG bytes."),
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
    docsCommand,
    createCommand,
    showCommand,
    editCommand,
    patchCommand,
    listCommand,
    restoreCommand,
    shareCommand,
    pullCommand,
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
const diagramPatcherLayer = Layer.provide(
  DiagramPatcherLive,
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
const excalidrawShareLayer = Layer.provide(
  ExcalidrawShareLive,
  ShareTransportLive,
);

export const CliApplicationLayer = Layer.mergeAll(
  LocalFileSystemLive,
  StorageRootLive,
  diagramBuilderLayer,
  diagramPatcherLayer,
  diagramStoreLayer,
  diagramExporterLayer,
  CliPngRendererLive,
  excalidrawShareLayer,
  LinkOpenerLive,
  InputReaderLive.pipe(Layer.provide(LocalFileSystemLive)),
  OutputWriterLive,
);
