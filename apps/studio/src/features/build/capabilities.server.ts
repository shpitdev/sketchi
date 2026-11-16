import "@tanstack/react-start/server-only";

import {
	ArtifactStorage,
	makeMemoryArtifactStorage,
	makeObjectBucketArtifactStorage,
	type ArtifactStorageShape,
	BuildRuntimeEnvironment,
} from "@sketchi/diagrams/build";
import type { ArtifactFormat } from "@sketchi/drawing/artifacts";
import { Context, Effect, Layer } from "effect";
import {
	PlaygroundBindings,
	PlaygroundIds,
	PlaygroundRequestMetadata,
} from "../../server/context.server";
import {
	DEFAULT_ASSET_ORIGIN,
	PlaygroundBrowserRendering,
	PlaygroundBrowserRenderingLive,
	type CloudflareBrowserRunRendererOptions,
} from "../render/browser-renderer.server";
import { studioCommunityIcons } from "./community-icons.server";
import { playgroundIconCatalog } from "./icon-catalog.server";

/** Concrete host capabilities only. Family operations and policy stay in diagrams. */
export const StudioBuildHostLive = Layer.merge(
	PlaygroundBrowserRenderingLive,
	Layer.sync(ArtifactStorage, makeMemoryArtifactStorage),
);

export function artifactStoreForBindings(
	env: Context.Service.Shape<typeof PlaygroundBindings>,
	localStorage: ArtifactStorageShape,
): ArtifactStorageShape {
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

/** Build once in the HTTP request scope; callbacks receive this same context. */
export const StudioBuildRequestLive = Layer.effectContext(
	Effect.gen(function* () {
		const env = yield* PlaygroundBindings;
		const ids = yield* PlaygroundIds;
		const metadata = yield* PlaygroundRequestMetadata;
		const browserRendering = yield* PlaygroundBrowserRendering;
		const localStorage = yield* ArtifactStorage;
		return Context.make(ArtifactStorage, artifactStoreForBindings(env, localStorage)).pipe(
			Context.add(BuildRuntimeEnvironment, {
				createId: ids.create,
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
			}),
		);
	}),
);
