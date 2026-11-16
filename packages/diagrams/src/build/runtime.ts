import { type CanvasSpec } from "@sketchi/drawing";
import { type ArtifactFormat } from "@sketchi/drawing/artifacts";
import { Context, Effect, Layer, Schema } from "effect";

import { type BuildCommunityIcons, type BuildIconCatalog } from "./icons";

/** What a host supplies to every build operation: ids, icons, rendering and artifact URLs. */
export interface BuildRuntimeOptions {
	createId?: (prefix: string) => string;
	/** Node-logo catalog; without one, every node icon is dropped with a warning. */
	icons?: BuildIconCatalog;
	/** Published community icons, which a request names by `community/<slug>`. */
	communityIcons?: BuildCommunityIcons;
	renderer?: ArtifactRenderer;
	/** Internal per-call policy for optional default PNGs; explicit exports remain strict. */
	defaultPng?: {
		deadlineMillis: number;
		onUnavailable: (message: string) => void;
	};
	/**
	 * Internal per-call policy for MCP builds: in a diagram that draws logos, a
	 * node without one, or a flowchart group, gets the logo its label
	 * unmistakably names (see resolveNodeIcons and fillGroupLogos). Generation
	 * grounds logos in the prompt instead.
	 */
	fillNamedLogos?: boolean;
	artifactUrl?: (input: { artifactId: string; format: ArtifactFormat }) => string;
}

export class BuildRuntimeEnvironment extends Context.Service<
	BuildRuntimeEnvironment,
	Required<Pick<BuildRuntimeOptions, "createId">> &
		Pick<
			BuildRuntimeOptions,
			"artifactUrl" | "communityIcons" | "icons" | "renderer" | "defaultPng" | "fillNamedLogos"
		>
>()("@sketchi/diagrams/BuildRuntimeEnvironment") {}

export function makeBuildRuntimeEnvironmentLayer(options: BuildRuntimeOptions = {}) {
	return Layer.succeed(BuildRuntimeEnvironment, {
		createId: options.createId ?? defaultCreateId,
		...(options.icons ? { icons: options.icons } : {}),
		...(options.communityIcons ? { communityIcons: options.communityIcons } : {}),
		...(options.renderer ? { renderer: options.renderer } : {}),
		...(options.defaultPng ? { defaultPng: options.defaultPng } : {}),
		...(options.artifactUrl ? { artifactUrl: options.artifactUrl } : {}),
		...(options.fillNamedLogos ? { fillNamedLogos: true } : {}),
	});
}

function defaultCreateId(prefix: string): string {
	return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

export class ArtifactRenderFailed extends Schema.TaggedError<
	ArtifactRenderFailed,
	{ readonly brand: unique symbol }
>()("ArtifactRenderFailed", { cause: Schema.Defect(), message: Schema.String }) {}

/** Implementations may retain their own tagged renderer failures. */
type TaggedArtifactRenderFailure = Pick<ArtifactRenderFailed, "message"> & {
	readonly _tag: string;
};

export interface ArtifactRenderer<
	E extends TaggedArtifactRenderFailure = TaggedArtifactRenderFailure,
> {
	renderPng(input: {
		scene: CanvasSpec;
		excalidraw: unknown;
	}): Effect.Effect<ArrayBuffer | Uint8Array, E>;
}
