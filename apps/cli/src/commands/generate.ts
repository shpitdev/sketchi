import { DIAGRAM_TYPES } from "@sketchi/diagrams/family";
import { Effect, Option } from "effect";

import { alternativeList } from "../document";
import { type GenerationDestination, runGenerateWorkflow } from "../generate-workflow";
import {
	DEFAULT_GENERATE_ENDPOINT,
	resolveGenerateEndpoint,
	SKETCHI_GENERATE_ENDPOINT_ENV,
} from "../generation";
import { Command, Flag, invalidFlagValue, missingRequiredFlag } from "../terminal/effect-cli";
import {
	GenerateWizard,
	liveGenerateWizardAvailable,
	type WizardDestination,
} from "../terminal/generate-wizard";
import { copyGeneratedArtifact, reportGenerateOperation, textNeedsDisplayHint } from "./generated";
import { rootCommand } from "./root";

function wizardDestination(destination: WizardDestination): GenerationDestination {
	switch (destination._tag) {
		case "CurrentDirectory":
			return { _tag: "CurrentDirectory", cwd: process.cwd() };
		case "ProjectDiagrams":
			return { _tag: "ProjectDiagrams", cwd: process.cwd() };
		case "Custom":
			return destination;
	}
}

const GENERATE_HELP = `Create one persisted diagram and export its PNG by default. With no --prompt, Sketchi opens a short wizard only when stdin and stdout are human TTYs, output is text, and CI is absent. Pipes, redirects, CI, and --output json never prompt or block; pass --prompt for every script and automation path. This is one of Sketchi's five explicit network commands (generate, revise, canvas, share, pull). It makes one unauthenticated HTTPS POST to the public Sketchi generate API and needs no token, key, account, or login.

Everyday wizard:
  The wizard asks only for prompt text, a diagram type (any of the ${String(DIAGRAM_TYPES.length)} below; flowchart is the default),
  and a PNG destination.
  Current directory writes <cwd>/<generated-id>.png. Project diagrams folder means exactly the
  directory where Sketchi was run: <cwd>/diagrams/<generated-id>.png, with no Git detection; the
  diagrams folder is created only after generation succeeds. Explicit --type and file --dest values
  preset and skip those questions. Explicit --format png may proceed; pass --prompt for another
  format or --dest - because the interactive wizard writes only PNG files.

Network and options:
  Endpoint: ${DEFAULT_GENERATE_ENDPOINT}
  The model call, schema validation, and quality gate run server-side; the finished diagram
  and Excalidraw artifact are returned over plain HTTPS. Sketchi sends no credentials.
  Without --type, the model selects ${alternativeList([...DIAGRAM_TYPES])} from the request;
  a request for any other kind of diagram gets the closest of those.
  Override the endpoint for preview or local testing with ${SKETCHI_GENERATE_ENDPOINT_ENV}
  or --endpoint URL. --format defaults to png. Without --dest, the artifact is written as
  <generated-id>.png, <generated-id>.excalidraw, or <generated-id>.scene.json in the current
  directory. --dest PATH|- overrides that path. --output text|json controls only the status envelope.

Validation and storage:
  The returned diagram is decoded against Sketchi's canonical package schemas and atomically
  committed through the create store at ~/.sketchi/diagrams/<id>/. Colors and shapes the prompt
  asks for ("the reject path in red", "the gate as a purple diamond") come back as patch operations
  and are drawn as revision 2, as sketchi patch would; revision 1 keeps the unstyled diagram. The record contains
  manifest.json, document.json, scene.json, and diagram.excalidraw. PNG rendering remains lazy
  and is not written back to that record. Network/endpoint/timeout/output/validation/storage
  failures leave no visible record; a later export destination failure leaves the created record.

Clipboard:
  After writing a PNG file, generate copies the image to the desktop clipboard (wl-copy on
  Wayland, xclip on X11, osascript on macOS, PowerShell on Windows) and says so. It never copies in
  CI, for --dest -, for another --format, or with --no-copy, and stays quiet when the session has
  no desktop clipboard. A clipboard failure prints one line and never changes the exit code.
  SKETCHI_CLIPBOARD_COMMAND=CMD|off replaces the detected tool or turns copying off.
  --output json reports clipboard {copied, reason?}. sketchi copy [ID] copies any stored diagram.

Errors and next steps:
  Exit 10 means a network or endpoint failure, 11 a timeout, and 12 malformed output;
  a rejected or invalid generated document uses 3, conflict uses 6, and storage uses 7.
  With --dest -, stdout contains artifact bytes only and all status uses stderr. On success, pass
  the returned id, a unique prefix of it, or latest to show, copy, edit, or export. For strictly
  offline manual authoring, accepted canonical JSON examples, and full error contracts, run
  sketchi docs.`;

export const generateCommand = Command.make(
	"generate",
	{
		prompt: Flag.optional(
			Flag.String("prompt").pipe(
				Flag.withDescription("Diagram request text sent directly without interactive prompts."),
				Flag.withMetavar("TEXT"),
			),
		),
		type: Flag.optional(
			Flag.Literals("type", DIAGRAM_TYPES).pipe(
				Flag.withDescription("Authoritative diagram type; omit for model selection."),
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
				Flag.withDescription("Artifact exported after generation; default png."),
				Flag.withMetavar("png|excalidraw|scene"),
			),
		),
		destination: Flag.optional(
			Flag.String("dest").pipe(
				Flag.withDescription(
					"Artifact destination; defaults from the generated id, or - for stdout.",
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
			const suppliedPrompt = Option.getOrUndefined(input.prompt);
			const suppliedType = Option.getOrUndefined(input.type);
			const suppliedFormat = Option.getOrUndefined(input.format);
			const suppliedDestination = Option.getOrUndefined(input.destination);
			if (suppliedPrompt === undefined) {
				if (!liveGenerateWizardAvailable(output)) {
					return yield* missingRequiredFlag("prompt");
				}
				if (suppliedFormat !== undefined && suppliedFormat !== "png") {
					return yield* invalidFlagValue(
						"format",
						suppliedFormat,
						"png when --prompt is omitted; pass --prompt for excalidraw or scene generation",
					);
				}
				if (suppliedDestination === "-") {
					return yield* invalidFlagValue(
						"dest",
						suppliedDestination,
						"a file path when --prompt is omitted; pass --prompt to write an artifact to stdout",
					);
				}
				const wizard = yield* GenerateWizard;
				yield* reportGenerateOperation(
					output,
					Effect.scoped(
						Effect.gen(function* () {
							const answers = yield* wizard.ask({
								...(suppliedType === undefined ? {} : { type: suppliedType }),
								...(suppliedDestination === undefined
									? {}
									: {
											destination: {
												_tag: "Custom",
												path: suppliedDestination,
											},
										}),
							});
							const activity = yield* wizard.activity;
							const result = yield* runGenerateWorkflow({
								endpoint: input.endpoint,
								prompt: answers.prompt,
								type: answers.type,
								format: "png",
								destination: wizardDestination(answers.destination),
							});
							const clipboard = yield* copyGeneratedArtifact(result.artifact, input.copy);
							yield* activity.succeed("Diagram ready");
							return { ...result, clipboard, displayHint: textNeedsDisplayHint() };
						}),
					),
				);
				return;
			}
			yield* reportGenerateOperation(
				output,
				runGenerateWorkflow({
					endpoint: input.endpoint,
					prompt: suppliedPrompt,
					...(suppliedType ? { type: suppliedType } : {}),
					format: suppliedFormat ?? "png",
					destination:
						suppliedDestination === undefined
							? { _tag: "Default" }
							: { _tag: "Custom", path: suppliedDestination },
				}).pipe(
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
			);
		}),
).pipe(
	Command.withDescription(GENERATE_HELP),
	Command.withShortDescription("Create a PNG with the wizard or a direct --prompt."),
	Command.withExamples([
		{
			command: 'sketchi generate --prompt "Map release approval with pass and revise branches"',
			description: "Generate a flowchart and write its PNG.",
		},
		{
			command:
				'sketchi generate --prompt "Organize launch readiness" --type mindmap --format excalidraw --dest launch.excalidraw --output json',
			description: "Generate a mindmap and write editable Excalidraw.",
		},
		{
			command:
				'sketchi generate --prompt "Show Browser calling API" --type sequence --dest request-sequence.png',
			description: "Generate a native sequence diagram and write its PNG.",
		},
	]),
);
