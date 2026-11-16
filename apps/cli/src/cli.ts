import { CodeModeArtifactStorageMemory } from "@sketchi/diagrams/build/code-mode/artifacts";
import { makeCodeModeRuntimeEnvironmentLayer } from "@sketchi/diagrams/build/code-mode/runtime";
import { Cause, Effect, type FileSystem, Layer, Option } from "effect";
import type { Stdio } from "effect/Stdio";

import { DiagramBuilderLive } from "./builder.js";
import { canvasCommand } from "./commands/canvas.js";
import { copyCommand } from "./commands/copy.js";
import { createCommand } from "./commands/create.js";
import { docsCommand } from "./commands/docs.js";
import { editCommand } from "./commands/edit.js";
import { exportCommand } from "./commands/export.js";
import { generateCommand } from "./commands/generate.js";
import { iconCommand } from "./commands/icon.js";
import { listCommand } from "./commands/list.js";
import { patchCommand } from "./commands/patch.js";
import { pullCommand } from "./commands/pull.js";
import { restoreCommand } from "./commands/restore.js";
import { reviseCommand } from "./commands/revise.js";
import { rootCommand } from "./commands/root.js";
import { shareCommand } from "./commands/share.js";
import { showCommand } from "./commands/show.js";
import { CliFilesystemError } from "./errors.js";
import { LocalFileSystemLive } from "./filesystem.js";
import { cliIconCatalog } from "./icon-catalog.js";
import { DiagramPatcherLive } from "./patch.js";
import { DiagramExporterLive } from "./render/exporter.js";
import { CliPngRendererLive } from "./render/png-renderer.js";
import { ExcalidrawShareLive, LinkOpenerLive, ShareTransportLive } from "./share/excalidraw.js";
import { ShareCryptoLive } from "./share/protocol.js";
import { DiagramStoreLive } from "./store/live.js";
import { type StorageRoot, StorageRootLive } from "./store/service.js";
import { Clipboard, ClipboardLive } from "./terminal/clipboard.js";
import {
	cliErrorExitCode,
	Command,
	requestedOutputFormat,
	runEffectCommand,
} from "./terminal/effect-cli.js";
import { GenerateWizardLive } from "./terminal/generate-wizard.js";
import { InputReaderLive } from "./terminal/input.js";
import {
	CliCommandExit,
	internalErrorText,
	OutputWriter,
	OutputWriterLive,
} from "./terminal/output.js";

export const sketchiCommand = rootCommand.pipe(
	Command.withSubcommands([
		generateCommand,
		reviseCommand,
		canvasCommand,
		iconCommand,
		docsCommand,
		createCommand,
		showCommand,
		editCommand,
		patchCommand,
		listCommand,
		copyCommand,
		restoreCommand,
		shareCommand,
		pullCommand,
		exportCommand,
	]),
);

export const cliProgram = Effect.fn("sketchi.cli.run")(function* (args: ReadonlyArray<string>) {
	const format = requestedOutputFormat(args);
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
					yield* writer.stderr(internalErrorText(format)).pipe(Effect.catch(() => Effect.void));
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
		icons: cliIconCatalog,
	}),
);
const diagramBuilderLayer = Layer.provide(DiagramBuilderLive, codeModeDependencies);
const diagramPatcherLayer = Layer.provide(DiagramPatcherLive, codeModeDependencies);
const excalidrawShareLayer = Layer.provide(
	ExcalidrawShareLive,
	Layer.mergeAll(ShareTransportLive, ShareCryptoLive),
);

/** The application with its storage root, clipboard, and output chosen by the caller, for tests. */
export function makeCliApplicationLayer({
	clipboard,
	output,
	storageRoot,
}: {
	readonly storageRoot: Layer.Layer<StorageRoot>;
	readonly clipboard: Layer.Layer<Clipboard, never, FileSystem.FileSystem>;
	readonly output: Layer.Layer<OutputWriter, never, Stdio>;
}) {
	const diagramStoreLayer = Layer.provide(
		DiagramStoreLive,
		Layer.mergeAll(LocalFileSystemLive, storageRoot),
	);
	const diagramExporterLayer = Layer.provide(
		DiagramExporterLive,
		Layer.mergeAll(diagramStoreLayer, CliPngRendererLive),
	);
	return Layer.mergeAll(
		LocalFileSystemLive,
		storageRoot,
		diagramBuilderLayer,
		diagramPatcherLayer,
		diagramStoreLayer,
		diagramExporterLayer,
		CliPngRendererLive,
		excalidrawShareLayer,
		LinkOpenerLive,
		InputReaderLive.pipe(Layer.provide(LocalFileSystemLive)),
		output,
		GenerateWizardLive,
		clipboard,
	);
}

export const CliApplicationLayer = makeCliApplicationLayer({
	storageRoot: StorageRootLive,
	clipboard: ClipboardLive,
	output: OutputWriterLive,
});
