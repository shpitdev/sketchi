import "@tanstack/react-start/server-only";

import {
	applyDiagramPatch,
	buildFlowchart,
	buildMindmap,
	buildSequenceDiagram,
	buildStateMachine,
	buildGantt,
	buildErDiagram,
	buildClassDiagram,
	buildOrgChart,
	buildVennDiagram,
	buildTimeline,
	buildChart,
	CodeModeArtifactStorage,
	CodeModeRuntimeEnvironment,
	getArtifact,
	createCanvas,
	makeMemoryArtifactStorage,
	searchIcons,
	makeObjectBucketArtifactStorage,
	type ApplyDiagramPatchResult,
	type ArtifactFormat,
	type BuildFlowchartResult,
	type BuildMindmapResult,
	type BuildSequenceDiagramResult,
	type BuildStateMachineResult,
	type BuildGanttResult,
	type BuildErDiagramResult,
	type BuildClassDiagramResult,
	type BuildOrgChartResult,
	type BuildVennDiagramResult,
	type BuildTimelineResult,
	type BuildChartResult,
	type CodeModeArtifactStorageError,
	type CodeModeArtifactStorageShape,
	type CodeModeRuntimeOptions,
	type CreateCanvasResult,
	type GetArtifactResult,
	type SearchIconsResult,
	type StoredArtifactFormat,
} from "@sketchi/diagram-agent";
import { Context, Effect, Layer } from "effect";

import {
	PlaygroundBindings,
	PlaygroundIds,
	PlaygroundRequestMetadata,
} from "../runtime/context.server";
import {
	DEFAULT_ASSET_ORIGIN,
	PlaygroundBrowserRendering,
	PlaygroundBrowserRenderingLive,
	type CloudflareBrowserRunRendererOptions,
} from "./browser-renderer.server";
import { playgroundIconCatalog } from "./icon-catalog.server";

export type CodeModeRequestContext = PlaygroundBindings | PlaygroundIds | PlaygroundRequestMetadata;

export interface PlaygroundCodeModeShape {
	readonly applyDiagramPatch: (
		input: unknown,
	) => Effect.Effect<ApplyDiagramPatchResult, never, CodeModeRequestContext>;
	readonly buildFlowchart: (
		input: unknown,
	) => Effect.Effect<BuildFlowchartResult, never, CodeModeRequestContext>;
	readonly buildMindmap: (
		input: unknown,
	) => Effect.Effect<BuildMindmapResult, never, CodeModeRequestContext>;
	readonly buildSequenceDiagram: (
		input: unknown,
	) => Effect.Effect<BuildSequenceDiagramResult, never, CodeModeRequestContext>;
	readonly buildTimeline: (
		input: unknown,
	) => Effect.Effect<BuildTimelineResult, never, CodeModeRequestContext>;
	readonly buildChart: (
		input: unknown,
	) => Effect.Effect<BuildChartResult, never, CodeModeRequestContext>;
	readonly buildStateMachine: (
		input: unknown,
	) => Effect.Effect<BuildStateMachineResult, never, CodeModeRequestContext>;
	readonly buildGantt: (
		input: unknown,
	) => Effect.Effect<BuildGanttResult, never, CodeModeRequestContext>;
	readonly buildErDiagram: (
		input: unknown,
	) => Effect.Effect<BuildErDiagramResult, never, CodeModeRequestContext>;
	readonly buildClassDiagram: (
		input: unknown,
	) => Effect.Effect<BuildClassDiagramResult, never, CodeModeRequestContext>;
	readonly buildOrgChart: (
		input: unknown,
	) => Effect.Effect<BuildOrgChartResult, never, CodeModeRequestContext>;
	readonly buildVennDiagram: (
		input: unknown,
	) => Effect.Effect<BuildVennDiagramResult, never, CodeModeRequestContext>;
	readonly createCanvas: (
		input: unknown,
	) => Effect.Effect<CreateCanvasResult, never, CodeModeRequestContext>;
	readonly getArtifact: (
		input: unknown,
	) => Effect.Effect<GetArtifactResult, never, CodeModeRequestContext>;
	readonly searchIcons: (
		input: unknown,
	) => Effect.Effect<SearchIconsResult, never, CodeModeRequestContext>;
	/** Opens a PNG export page ahead of a session's first export. */
	readonly prewarmPngRenderer: Effect.Effect<
		void,
		never,
		PlaygroundBindings | PlaygroundRequestMetadata
	>;
	readonly readStoredArtifact: (
		artifactId: string,
		format: ArtifactFormat,
	) => Effect.Effect<StoredArtifactFormat | null, CodeModeArtifactStorageError, PlaygroundBindings>;
}

/** Optional transport delivery policy, not a public request option or runtime authority. */
export const PlaygroundDefaultPngDelivery = Context.Reference<CodeModeRuntimeOptions["defaultPng"]>(
	"@sketchi/playground/DefaultPngDelivery",
	{ defaultValue: () => undefined },
);

/** MCP builds fill the logo a node's label names; see CodeModeRuntimeOptions.fillNamedLogos. */
export const PlaygroundNamedLogoFill = Context.Reference<boolean>(
	"@sketchi/playground/NamedLogoFill",
	{ defaultValue: () => false },
);

export class PlaygroundCodeMode extends Context.Service<
	PlaygroundCodeMode,
	PlaygroundCodeModeShape
>()("@sketchi/playground/PlaygroundCodeMode") {}

const PlaygroundLocalArtifactStorageLive = Layer.effect(
	CodeModeArtifactStorage,
	Effect.sync(makeMemoryArtifactStorage),
);

export function artifactStoreForBindings(
	env: Context.Service.Shape<typeof PlaygroundBindings>,
	localStorage: CodeModeArtifactStorageShape,
): CodeModeArtifactStorageShape {
	return env.SKETCHI_ARTIFACTS
		? makeObjectBucketArtifactStorage(env.SKETCHI_ARTIFACTS, {
				prefix: "codemode",
			})
		: localStorage;
}

function artifactUrl(
	origin: string,
	input: { artifactId: string; format: ArtifactFormat },
): string {
	const url = new URL(`/api/v1/artifacts/${encodeURIComponent(input.artifactId)}`, origin);
	url.searchParams.set("format", input.format);
	url.searchParams.set("raw", "true");
	return url.toString();
}

function rendererOptions(
	env: Context.Service.Shape<typeof PlaygroundBindings>,
	origin: string,
): CloudflareBrowserRunRendererOptions {
	if (env.SKETCHI_RENDER_ASSET_ORIGIN) {
		return { assetOrigin: env.SKETCHI_RENDER_ASSET_ORIGIN };
	}
	if (!isLocalOrigin(origin)) {
		return { assetOrigin: origin };
	}
	return { assetOrigin: DEFAULT_ASSET_ORIGIN };
}

function isLocalOrigin(origin: string): boolean {
	try {
		const hostname = new URL(origin).hostname;
		return hostname === "localhost" || hostname === "127.0.0.1";
	} catch {
		return false;
	}
}

export const PlaygroundCodeModeLive = Layer.effect(
	PlaygroundCodeMode,
	Effect.gen(function* () {
		const browserRendering = yield* PlaygroundBrowserRendering;
		const localStorage = yield* CodeModeArtifactStorage;

		const provideRequestCodeMode = Effect.fn("playground.codeMode.provideRequestServices")(
			function* <A>(
				workflow: Effect.Effect<A, never, CodeModeArtifactStorage | CodeModeRuntimeEnvironment>,
			) {
				const env = yield* PlaygroundBindings;
				const ids = yield* PlaygroundIds;
				const metadata = yield* PlaygroundRequestMetadata;
				const storage = artifactStoreForBindings(env, localStorage);
				const defaultPng = yield* PlaygroundDefaultPngDelivery;
				const fillNamedLogos = yield* PlaygroundNamedLogoFill;
				const runtimeEnvironment: Context.Service.Shape<typeof CodeModeRuntimeEnvironment> = {
					createId: ids.create,
					...(defaultPng ? { defaultPng } : {}),
					...(fillNamedLogos ? { fillNamedLogos } : {}),
					artifactUrl: (input) => artifactUrl(metadata.origin, input),
					...(env.ASSETS ? { icons: playgroundIconCatalog(env.ASSETS, metadata.origin) } : {}),
					...(env.CODEMODE_PNG_RENDERER
						? {
								renderer: browserRendering.renderer(
									env.CODEMODE_PNG_RENDERER,
									rendererOptions(env, metadata.origin),
								),
							}
						: {}),
				} satisfies CodeModeRuntimeOptions;

				return yield* workflow.pipe(
					Effect.provideService(CodeModeArtifactStorage, storage),
					Effect.provideService(CodeModeRuntimeEnvironment, runtimeEnvironment),
				);
			},
		);

		return PlaygroundCodeMode.of({
			applyDiagramPatch: Effect.fn("playground.codeMode.applyDiagramPatch")((input) =>
				provideRequestCodeMode(applyDiagramPatch(input)),
			),
			buildFlowchart: Effect.fn("playground.codeMode.buildFlowchart")((input) =>
				provideRequestCodeMode(buildFlowchart(input)),
			),
			buildMindmap: Effect.fn("playground.codeMode.buildMindmap")((input) =>
				provideRequestCodeMode(buildMindmap(input)),
			),
			buildSequenceDiagram: Effect.fn("playground.codeMode.buildSequenceDiagram")((input) =>
				provideRequestCodeMode(buildSequenceDiagram(input)),
			),
			buildTimeline: Effect.fn("playground.codeMode.buildTimeline")((input) =>
				provideRequestCodeMode(buildTimeline(input)),
			),
			buildChart: Effect.fn("playground.codeMode.buildChart")((input) =>
				provideRequestCodeMode(buildChart(input)),
			),
			buildStateMachine: Effect.fn("playground.codeMode.buildStateMachine")((input) =>
				provideRequestCodeMode(buildStateMachine(input)),
			),
			buildGantt: Effect.fn("playground.codeMode.buildGantt")((input) =>
				provideRequestCodeMode(buildGantt(input)),
			),
			buildErDiagram: Effect.fn("playground.codeMode.buildErDiagram")((input) =>
				provideRequestCodeMode(buildErDiagram(input)),
			),
			buildClassDiagram: Effect.fn("playground.codeMode.buildClassDiagram")((input) =>
				provideRequestCodeMode(buildClassDiagram(input)),
			),
			buildOrgChart: Effect.fn("playground.codeMode.buildOrgChart")((input) =>
				provideRequestCodeMode(buildOrgChart(input)),
			),
			buildVennDiagram: Effect.fn("playground.codeMode.buildVennDiagram")((input) =>
				provideRequestCodeMode(buildVennDiagram(input)),
			),
			createCanvas: Effect.fn("playground.codeMode.createCanvas")((input) =>
				provideRequestCodeMode(createCanvas(input)),
			),
			getArtifact: Effect.fn("playground.codeMode.getArtifact")((input) =>
				provideRequestCodeMode(getArtifact(input)),
			),
			searchIcons: Effect.fn("playground.codeMode.searchIcons")((input) =>
				provideRequestCodeMode(searchIcons(input)),
			),
			prewarmPngRenderer: Effect.gen(function* () {
				const env = yield* PlaygroundBindings;
				const metadata = yield* PlaygroundRequestMetadata;
				if (env.CODEMODE_PNG_RENDERER) {
					yield* browserRendering.renderer(
						env.CODEMODE_PNG_RENDERER,
						rendererOptions(env, metadata.origin),
					).prewarm;
				}
			}).pipe(Effect.withSpan("playground.codeMode.prewarmPngRenderer")),
			readStoredArtifact: Effect.fn("playground.codeMode.readStoredArtifact")(
				function* (artifactId, format) {
					const env = yield* PlaygroundBindings;
					return yield* artifactStoreForBindings(env, localStorage).read(artifactId, format);
				},
			),
		});
	}),
).pipe(
	Layer.provideMerge(
		Layer.merge(PlaygroundBrowserRenderingLive, PlaygroundLocalArtifactStorageLive),
	),
);
