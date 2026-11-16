import { ArtifactStorageMemory, makeBuildRuntimeEnvironmentLayer } from "@sketchi/diagrams/build";
import { Cause, Effect, type FileSystem, Layer, Option } from "effect";
import type { Stdio } from "effect/Stdio";

import { DiagramBuilderLive } from "./builder";
import { canvasCommand } from "./commands/canvas";
import { copyCommand } from "./commands/copy";
import { createCommand } from "./commands/create";
import { docsCommand } from "./commands/docs";
import { editCommand } from "./commands/edit";
import { exportCommand } from "./commands/export";
import { generateCommand } from "./commands/generate";
import { iconCommand } from "./commands/icon";
import { listCommand } from "./commands/list";
import { patchCommand } from "./commands/patch";
import { pullCommand } from "./commands/pull";
import { restoreCommand } from "./commands/restore";
import { reviseCommand } from "./commands/revise";
import { rootCommand } from "./commands/root";
import { shareCommand } from "./commands/share";
import { showCommand } from "./commands/show";
import { CliFilesystemError } from "./errors";
import { LocalFileSystemLive } from "./filesystem";
import { cliIconCatalog } from "./icon-catalog";
import { DiagramPatcherLive } from "./patch";
import { DiagramExporterLive } from "./render/exporter";
import { CliPngRendererLive } from "./render/png-renderer";
import { ExcalidrawShareLive, LinkOpenerLive, ShareTransportLive } from "./share/excalidraw";
import { ShareCryptoLive } from "./share/protocol";
import { DiagramStoreLive } from "./store/live";
import { type StorageRoot, StorageRootLive } from "./store/service";
import { Clipboard, ClipboardLive } from "./terminal/clipboard";
import {
	cliErrorExitCode,
	Command,
	requestedOutputFormat,
	runEffectCommand,
} from "./terminal/effect-cli";
import { GenerateWizardLive } from "./terminal/generate-wizard";
import { InputReaderLive } from "./terminal/input";
import {
	CliCommandExit,
	internalErrorText,
	OutputWriter,
	OutputWriterLive,
} from "./terminal/output";

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

const buildServices = Layer.mergeAll(
	ArtifactStorageMemory,
	makeBuildRuntimeEnvironmentLayer({
		createId: (prefix) => `${prefix}_offline_cli`,
		icons: cliIconCatalog,
	}),
);
const diagramBuilderLayer = Layer.provide(DiagramBuilderLive, buildServices);
const diagramPatcherLayer = Layer.provide(DiagramPatcherLive, buildServices);
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
