import "@tanstack/react-start/server-only";
import {
	BuildTimelineResultSchema,
	BuildTimelineToolInputSchema,
	type BuildTimelineResult,
	type BuildTimelineToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";
export const STUDIO_BUILD_TIMELINE_TOOL_NAME = "build_timeline" as const;
export const STUDIO_BUILD_TIMELINE_TOOL_DESCRIPTION =
	"Build and persist a native timeline from semantic events with dates or explicit order. Preserve every supplied event and date, invent none. Use one consistent chronology mode, no durations/resources/dependencies. The host lays out and wraps the timeline. Repair structured issues, up to three total attempts.";
export const StudioBuildTimelineInputSchema = toPlaygroundStandardSchema(
	BuildTimelineToolInputSchema,
);
export const StudioBuildTimelineOutputSchema =
	toPlaygroundStandardSchema(BuildTimelineResultSchema);
export function makeStudioTimelineToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildTimelineResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildTimelineToolInput, BuildTimelineResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildTimeline",
		...options,
	});
}
