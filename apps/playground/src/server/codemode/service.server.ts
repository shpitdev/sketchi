import {
	CodeModeArtifactStorage,
	makeMemoryArtifactStorage,
	makeObjectBucketArtifactStorage,
	type CodeModeArtifactStorageError,
	type CodeModeArtifactStorageShape,
	type StoredArtifactFormat,
} from "@sketchi/diagrams/build/code-mode/artifacts";
import {
	type ApplyDiagramPatchResult,
	type BuildFlowchartOptions,
	type CreateCanvasResult,
	type EditFlowchartResult,
	type GetArtifactResult,
	type SearchIconsResult,
} from "@sketchi/diagrams/build/code-mode/contract";
import { buildCanonicalDocument } from "@sketchi/diagrams/build/code-mode/documents";
import * as FamilyRuntime from "@sketchi/diagrams/build/code-mode/runtime";
import {
	applyDiagramPatch,
	CodeModeRuntimeEnvironment,
	createCanvas,
	editFlowchart,
	getArtifact,
	searchIcons,
	type CodeModeRuntimeOptions,
} from "@sketchi/diagrams/build/code-mode/runtime";
import {
	type CanonicalDiagramDocument,
	type FamilyBuildResult,
	type FamilyOperation,
} from "@sketchi/diagrams/family";
import "@tanstack/react-start/server-only";

import { type ArtifactFormat } from "@sketchi/drawing/artifacts";
import { withSpanContent } from "@sketchi/observability";
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
import { studioCommunityIcons } from "./community-icons.server";
import { playgroundIconCatalog } from "./icon-catalog.server";

export type CodeModeRequestContext = PlaygroundBindings | PlaygroundIds | PlaygroundRequestMetadata;

export interface PlaygroundCodeModeShape {
	readonly buildFamily: <A>(
		family: FamilyOperation<A>,
		input: unknown,
	) => Effect.Effect<A, never, CodeModeRequestContext>;
	readonly buildDocument: (
		document: CanonicalDiagramDocument,
		options?: BuildFlowchartOptions,
	) => Effect.Effect<FamilyBuildResult, never, CodeModeRequestContext>;

	readonly applyDiagramPatch: (
		input: unknown,
	) => Effect.Effect<ApplyDiagramPatchResult, never, CodeModeRequestContext>;
	readonly editFlowchart: (
		input: unknown,
	) => Effect.Effect<EditFlowchartResult, never, CodeModeRequestContext>;
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

export function rendererOptions(
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
					...(env.COMMUNITY_ICONS
						? { communityIcons: studioCommunityIcons(env.COMMUNITY_ICONS) }
						: {}),
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
			buildFamily: <A>(family: FamilyOperation<A>, input: unknown) =>
				withSpanContent(input, provideRequestCodeMode(family.build(FamilyRuntime)(input))).pipe(
					Effect.withSpan(`playground.codeMode.${family.operation}`),
				),
			buildDocument: Effect.fn("playground.codeMode.buildDocument")((document, options) =>
				withSpanContent(
					{ document, options },
					provideRequestCodeMode(buildCanonicalDocument(document, options)),
				),
			),

			applyDiagramPatch: Effect.fn("playground.codeMode.applyDiagramPatch")((input) =>
				withSpanContent(input, provideRequestCodeMode(applyDiagramPatch(input))),
			),
			editFlowchart: Effect.fn("playground.codeMode.editFlowchart")((input) =>
				withSpanContent(input, provideRequestCodeMode(editFlowchart(input))),
			),
			createCanvas: Effect.fn("playground.codeMode.createCanvas")((input) =>
				withSpanContent(input, provideRequestCodeMode(createCanvas(input))),
			),
			getArtifact: Effect.fn("playground.codeMode.getArtifact")((input) =>
				withSpanContent(input, provideRequestCodeMode(getArtifact(input))),
			),
			searchIcons: Effect.fn("playground.codeMode.searchIcons")((input) =>
				withSpanContent(input, provideRequestCodeMode(searchIcons(input))),
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
