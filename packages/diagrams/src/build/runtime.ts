import { type CanvasSpec } from "@sketchi/drawing";
import { type ArtifactFormat } from "@sketchi/drawing/artifacts";
import { Context, Effect, Layer, Schema } from "effect";

import { type CodeModeCommunityIcons, type CodeModeIconCatalog } from "./icons";

/** What a host supplies to every Code Mode operation: ids, icons, rendering and artifact URLs. */
export interface CodeModeRuntimeOptions {
	createId?: (prefix: string) => string;
	/** Node-logo catalog; without one, every node icon is dropped with a warning. */
	icons?: CodeModeIconCatalog;
	/** Published community icons, which a request names by `community/<slug>`. */
	communityIcons?: CodeModeCommunityIcons;
	renderer?: CodeModeArtifactRenderer;
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

export class CodeModeRuntimeEnvironment extends Context.Service<
	CodeModeRuntimeEnvironment,
	Required<Pick<CodeModeRuntimeOptions, "createId">> &
		Pick<
			CodeModeRuntimeOptions,
			"artifactUrl" | "communityIcons" | "icons" | "renderer" | "defaultPng" | "fillNamedLogos"
		>
>()("@sketchi/diagram-agent/CodeModeRuntimeEnvironment") {}

export function makeCodeModeRuntimeEnvironmentLayer(options: CodeModeRuntimeOptions = {}) {
	return Layer.succeed(CodeModeRuntimeEnvironment, {
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

export class CodeModeArtifactRenderFailed extends Schema.TaggedError<
	CodeModeArtifactRenderFailed,
	{ readonly brand: unique symbol }
>()("CodeModeArtifactRenderFailed", { cause: Schema.Defect(), message: Schema.String }) {}

/** Implementations may retain their own tagged renderer failures. */
type TaggedArtifactRenderFailure = Pick<CodeModeArtifactRenderFailed, "message"> & {
	readonly _tag: string;
};

export interface CodeModeArtifactRenderer<
	E extends TaggedArtifactRenderFailure = TaggedArtifactRenderFailure,
> {
	renderPng(input: {
		scene: CanvasSpec;
		excalidraw: unknown;
	}): Effect.Effect<ArrayBuffer | Uint8Array, E>;
}
