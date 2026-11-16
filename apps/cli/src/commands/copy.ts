import { Effect } from "effect";

import { LATEST_DIAGRAM, resolveDiagramId } from "../diagram-catalog";
import { CliExportError } from "../errors";
import { DiagramExporter } from "../render/exporter";
import { DiagramStore } from "../store/service";
import { Clipboard } from "../terminal/clipboard";
import { Argument, Command } from "../terminal/effect-cli";
import { runReported } from "../terminal/output";
import { COPIED_ROW, headline, row } from "./present";
import { rootCommand } from "./root";

export const copyCommand = Command.make(
	"copy",
	{
		diagramId: Argument.String("diagram-id").pipe(
			Argument.withDescription(
				`A stored id, a unique prefix of one, or ${LATEST_DIAGRAM} (the default) for the newest.`,
			),
			Argument.withDefault(LATEST_DIAGRAM),
		),
	},
	({ diagramId }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const store = yield* DiagramStore;
			const exporter = yield* DiagramExporter;
			const clipboard = yield* Clipboard;
			const operation = Effect.gen(function* () {
				const id = yield* resolveDiagramId(diagramId);
				const diagram = yield* store.show(id);
				const png = yield* exporter.exportArtifact(id, "png");
				const outcome = yield* clipboard.copyPng(png);
				if (outcome._tag !== "Copied") {
					return yield* CliExportError.make({
						code: "clipboard_unavailable",
						diagramId: id,
						format: "png",
						message: `Could not copy "${id}": ${outcome.reason}.`,
						hint: `Write the PNG to a file instead: sketchi export ${id} --format png --dest ${id}.png`,
					});
				}
				return diagram;
			});
			yield* runReported(
				"copy",
				output,
				operation,
				(diagram) => [headline(diagram), COPIED_ROW, row("Id", diagram.manifest.id)].join("\n"),
				(diagram) => ({
					id: diagram.manifest.id,
					type: diagram.manifest.type,
					title: diagram.manifest.title,
					clipboard: { copied: true },
				}),
			);
		}),
).pipe(
	Command.withDescription(
		"Copy a stored diagram's PNG to the desktop clipboard, rendering it on demand like export. Defaults to the newest diagram. Uses wl-copy on Wayland, xclip on X11, osascript on macOS, and PowerShell on Windows; with no desktop clipboard it fails with exit 8 and says why. Strictly offline and read-only.",
	),
	Command.withShortDescription("Copy a diagram's PNG to the clipboard."),
	Command.withExamples([
		{ command: "sketchi copy", description: "Copy the newest diagram." },
		{ command: "sketchi copy release-flow", description: "Copy one diagram by id or prefix." },
	]),
);
