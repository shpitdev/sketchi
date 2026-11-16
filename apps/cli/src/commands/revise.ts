import { DIAGRAM_TYPES } from "@sketchi/diagrams/family";
import { Effect, Option } from "effect";

import { resolveDiagramId } from "../diagram-catalog";
import { runReviseWorkflow } from "../generate-workflow";
import { resolveGenerateEndpoint, SKETCHI_GENERATE_ENDPOINT_ENV } from "../generation";
import { Command, Flag } from "../terminal/effect-cli";
import { copyGeneratedArtifact, reportGenerateOperation, textNeedsDisplayHint } from "./generated";
import { diagramIdArgument, rootCommand } from "./root";

const REVISE_HELP = `Change a stored diagram with a request, keep the change as the record's next revision, and export its PNG by default. Sketchi sends the diagram's canonical document and the request to the public Sketchi generate API in one unauthenticated HTTPS POST; for a flowchart the model writes only edits by id, which the server applies and returns with the document (--output json shows them); for other families it returns the complete revised document. Either keeps the diagram's id and family, and everything the request does not mention stays as it was.

  --prompt TEXT says what to change: "add a fraud check before payment", "rename Ship to Ship order".
  --type TYPE turns the diagram into another family; omit it to keep its own.
  The earlier revision stays under revisions/ and sketchi restore brings it back. Patched, pulled
  and canvas records refuse revise, as edit does; restore a canonical revision first.
  A flowchart node's color is part of its document. Other colors and shapes the request asks for
  ("draw the reject path in red") are drawn as one more revision on top, as sketchi patch would;
  generate does the same.
  --endpoint, --format, --dest, --no-copy, the clipboard, exit codes and output work as for
  generate. Override the endpoint with ${SKETCHI_GENERATE_ENDPOINT_ENV} or --endpoint URL.`;

export const reviseCommand = Command.make(
	"revise",
	{
		diagramId: diagramIdArgument,
		prompt: Flag.String("prompt").pipe(
			Flag.withDescription("What to change in the diagram."),
			Flag.withMetavar("TEXT"),
		),
		type: Flag.optional(
			Flag.Literals("type", DIAGRAM_TYPES).pipe(
				Flag.withDescription("Turn the diagram into this family; omit to keep its own."),
				Flag.withMetavar("TYPE"),
			),
		),
		endpoint: Flag.String("endpoint").pipe(
			Flag.withDefault(resolveGenerateEndpoint()),
			Flag.withDescription(
				"Unauthenticated generate API URL; defaults to the production Sketchi endpoint.",
			),
			Flag.withMetavar("URL"),
		),
		format: Flag.optional(
			Flag.Literals("format", ["png", "excalidraw", "scene"]).pipe(
				Flag.withDescription("Artifact exported after the revision; default png."),
				Flag.withMetavar("png|excalidraw|scene"),
			),
		),
		destination: Flag.optional(
			Flag.String("dest").pipe(
				Flag.withDescription(
					"Artifact destination; defaults from the diagram id, or - for stdout.",
				),
				Flag.withMetavar("PATH|-"),
			),
		),
		copy: Flag.Boolean("copy").pipe(
			Flag.withDefault(true),
			Flag.withDescription("Copy the PNG to the clipboard; --no-copy skips it."),
		),
	},
	(input) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const suppliedType = Option.getOrUndefined(input.type);
			const suppliedDestination = Option.getOrUndefined(input.destination);
			yield* reportGenerateOperation(
				output,
				resolveDiagramId(input.diagramId).pipe(
					Effect.flatMap((diagramId) =>
						runReviseWorkflow({
							endpoint: input.endpoint,
							diagramId,
							prompt: input.prompt,
							...(suppliedType ? { type: suppliedType } : {}),
							format: Option.getOrUndefined(input.format) ?? "png",
							destination:
								suppliedDestination === undefined
									? { _tag: "Default" }
									: { _tag: "Custom", path: suppliedDestination },
						}),
					),
					Effect.flatMap((result) =>
						copyGeneratedArtifact(result.artifact, input.copy).pipe(
							Effect.map((clipboard) => ({
								...result,
								clipboard,
								displayHint: textNeedsDisplayHint(),
							})),
						),
					),
				),
				"revise",
			);
		}),
).pipe(
	Command.withDescription(REVISE_HELP),
	Command.withShortDescription("Change a stored diagram with a request."),
	Command.withExamples([
		{
			command: 'sketchi revise checkout --prompt "Add a fraud check before payment"',
			description: "Revise a diagram and write its new PNG.",
		},
		{
			command: 'sketchi revise latest --prompt "Show it as a sequence diagram" --type sequence',
			description: "Turn the newest diagram into another family.",
		},
	]),
);
