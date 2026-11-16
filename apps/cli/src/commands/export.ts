import { Effect } from "effect";

import { resolveDiagramId } from "../diagram-catalog";
import { DiagramExporter } from "../render/exporter";
import { writeExportFile } from "../store/export-file";
import { Command, Flag } from "../terminal/effect-cli";
import { runReportedArtifact } from "../terminal/output";
import { displayHint, exportData } from "./present";
import { diagramIdArgument, rootCommand } from "./root";

export const exportCommand = Command.make(
	"export",
	{
		diagramId: diagramIdArgument,
		format: Flag.Literals("format", ["scene", "excalidraw", "png"]).pipe(
			Flag.withDescription("Artifact format to export or render on demand."),
			Flag.withMetavar("scene|excalidraw|png"),
		),
		destination: Flag.String("dest").pipe(
			Flag.withDescription("Artifact byte destination path, or - for stdout."),
			Flag.withMetavar("PATH|-"),
		),
	},
	({ destination, diagramId, format }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const exporter = yield* DiagramExporter;
			const operation = Effect.gen(function* () {
				const id = yield* resolveDiagramId(diagramId);
				const bytes = yield* exporter.exportArtifact(id, format);
				if (destination !== "-") yield* writeExportFile(destination, bytes);
				return {
					id,
					format,
					destination,
					sizeBytes: bytes.byteLength,
					bytes,
					...(destination === "-" ? { stdoutBytes: bytes } : {}),
				};
			});
			yield* runReportedArtifact(
				"export",
				output,
				operation,
				(result) => result,
				(result) => {
					const hint = displayHint(result);
					return [
						`exported: ${result.id}`,
						`format: ${result.format}`,
						`destination: ${result.destination}`,
						`bytes: ${String(result.sizeBytes)}`,
						...(hint ? [`hint: ${hint}`] : []),
					].join("\n");
				},
				exportData,
				() => "stderr",
			);
		}),
).pipe(
	Command.withDescription(
		"Strictly offline export of a current stored artifact or on-demand PNG. Canonical PNG uses scene plus Excalidraw; detached PNG restores diagram.excalidraw directly, uses its viewBackgroundColor, and adds no stale canonical title. Detached scene export is unavailable. Rendering never starts a browser or network request and never writes the PNG back. Status always uses stderr, so --dest - leaves stdout byte-only. Render or write failures exit 8.",
	),
	Command.withShortDescription("Export scene, Excalidraw, or PNG bytes."),
	Command.withExamples([
		{
			command: "sketchi export release-flow --format excalidraw --dest release.excalidraw",
			description: "Write an Excalidraw artifact atomically to a file.",
		},
		{
			command: "sketchi export release-flow --format scene --dest - > scene.json",
			description: "Pipe raw scene bytes without status contamination.",
		},
	]),
);
