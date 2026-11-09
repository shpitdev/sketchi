import "@tanstack/react-start/server-only";
import {
	BuildMindmapResultSchema,
	BuildMindmapToolInputSchema,
	type BuildMindmapResult,
	type BuildMindmapToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_MINDMAP_TOOL_NAME = "build_mindmap" as const;
export const STUDIO_BUILD_MINDMAP_TOOL_DESCRIPTION =
	"Build and persist a native mindmap: a title and one root topic, each topic { label, children }. The host lays out the radial tree. Repair structured issues, up to three total attempts.";
export const StudioBuildMindmapInputSchema = toPlaygroundStandardSchema(
	BuildMindmapToolInputSchema,
);
export const StudioBuildMindmapOutputSchema = toPlaygroundStandardSchema(BuildMindmapResultSchema);
export function makeStudioMindmapToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildMindmapResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildMindmapToolInput, BuildMindmapResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildMindmap",
		...options,
	});
}
