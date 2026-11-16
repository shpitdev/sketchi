import { Effect, Option } from "effect";

import {
	createCanvasDiagram,
	type CreateCanvasDiagramResult,
	DEFAULT_CANVAS_ENDPOINT,
	readCanvasSpecInput,
	resolveCanvasEndpoint,
	SKETCHI_CANVAS_ENDPOINT_ENV,
} from "../canvas.js";
import { exportCreatedDiagram, type GenerateWorkflowResult } from "../generate-workflow.js";
import { API_REQUEST_TIMEOUT } from "../response-body.js";
import {
	Command,
	exclusiveInputSourceFlags,
	Flag,
	resolveInputSource,
} from "../terminal/effect-cli.js";
import { runReportedArtifact } from "../terminal/output.js";
import { displayHint, exportData, storedData, summaryText } from "./present.js";
import { rootCommand } from "./root.js";

interface CanvasCommandResult extends CreateCanvasDiagramResult {
	readonly artifact: GenerateWorkflowResult["artifact"];
}

function canvasData(result: CanvasCommandResult) {
	return {
		...storedData(result.diagram),
		remoteArtifactId: result.artifactId,
		export: exportData(result.artifact),
	};
}

function canvasText(result: CanvasCommandResult): string {
	const hint = displayHint(result.artifact);
	return [
		summaryText("created", result.diagram).replace(/^created:/u, "canvas:"),
		`remote artifact: ${result.artifactId}`,
		`format: ${result.artifact.format}`,
		`destination: ${result.artifact.destination}`,
		`bytes: ${String(result.artifact.sizeBytes)}`,
		...(hint ? [`hint: ${hint}`] : []),
	].join("\n");
}

const CANVAS_HELP = `Build a complete Universal CanvasSpec through Sketchi's public create-canvas API, preserve the validated scene and Excalidraw result in the local store, and export PNG by default. This command is direct and noninteractive: pass exactly one CanvasSpec with --file PATH, --file - for piped stdin, or --json VALUE.

Network and options:
  Endpoint: ${DEFAULT_CANVAS_ENDPOINT}
  Override it for preview or local testing with ${SKETCHI_CANVAS_ENDPOINT_ENV} or --endpoint URL.
  The request asks the server for scene and Excalidraw artifacts, validates the typed response,
  stores the normalized CanvasSpec plus Excalidraw output, then exports locally. --format defaults
  to png; --dest defaults to <diagramId>.png, <diagramId>.excalidraw, or
  <diagramId>.scene.json. Use --dest - for artifact-only stdout and --output json for a stable
  status envelope on stderr.

Input and failures:
  Input must be the CanvasSpec object itself, not a create-canvas request wrapper and not raw
  Excalidraw JSON. Interactive stdin is rejected with exit 2. Invalid JSON or CanvasSpec exits 3;
  a typed server rejection exits 4; network/endpoint failure exits 10; a request timeout after
  ${API_REQUEST_TIMEOUT} exits 11 (canvas_timeout); malformed response exits 12.
  The local record is committed before export, so a destination failure reports a concrete
  sketchi export recovery command. The existing sketchi create command remains the strictly
  offline path for accepted flowchart, mindmap, and sequence documents.`;

export const canvasCommand = Command.make(
	"canvas",
	{
		...exclusiveInputSourceFlags("CanvasSpec document"),
		endpoint: Flag.String("endpoint").pipe(
			Flag.withDefault(resolveCanvasEndpoint()),
			Flag.withDescription("Unauthenticated create-canvas API URL; defaults to production."),
			Flag.withMetavar("URL"),
		),
		format: Flag.Literals("format", ["png", "excalidraw", "scene"]).pipe(
			Flag.withDefault("png"),
			Flag.withDescription("Artifact exported after the canvas is created."),
			Flag.withMetavar("png|excalidraw|scene"),
		),
		destination: Flag.optional(
			Flag.String("dest").pipe(
				Flag.withDescription("Artifact destination; defaults from diagramId, or - for stdout."),
				Flag.withMetavar("PATH|-"),
			),
		),
	},
	({ destination, endpoint, format, fileInput, jsonInput }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const source = yield* resolveInputSource({ fileInput, jsonInput });
			const operation = Effect.gen(function* () {
				const spec = yield* readCanvasSpecInput(source);
				const created = yield* createCanvasDiagram({ endpoint, spec });
				const artifact = yield* exportCreatedDiagram(
					created.diagram,
					format,
					Option.match(destination, {
						onNone: () => ({ _tag: "Default" }),
						onSome: (path) => ({ _tag: "Custom", path }),
					}),
				);
				return { ...created, artifact } satisfies CanvasCommandResult;
			});
			yield* runReportedArtifact(
				"canvas",
				output,
				operation,
				(result) => result.artifact,
				canvasText,
				canvasData,
				(result) => (result.artifact.destination === "-" ? "stderr" : "stdout"),
			);
		}),
).pipe(
	Command.withDescription(CANVAS_HELP),
	Command.withShortDescription("Build and export a typed Universal CanvasSpec."),
	Command.withExamples([
		{
			command: "sketchi canvas --file canvas.json --output json",
			description: "Build a CanvasSpec, store it locally, and write its PNG.",
		},
		{
			command: "sketchi canvas --file - --format excalidraw --dest canvas.excalidraw",
			description: "Read CanvasSpec from stdin and export editable Excalidraw.",
		},
	]),
);
