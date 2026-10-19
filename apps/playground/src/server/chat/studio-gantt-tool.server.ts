import "@tanstack/react-start/server-only";
import {
	BuildGanttResultSchema,
	BuildGanttToolInputSchema,
	type BuildGanttResult,
	type BuildGanttToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";
export const STUDIO_BUILD_GANTT_TOOL_NAME = "build_gantt" as const;
export const STUDIO_BUILD_GANTT_TOOL_DESCRIPTION =
	"Build and persist a native Gantt chart: tasks with id, label, start (YYYY-MM-DD) and end (last day, inclusive) or duration (calendar days), optional milestone, phase, finish-to-start dependsOn ids and progress percent. Pass a stated duration as duration rather than computing end; invent no tasks or dates. The host draws the date axis, rows and dependency arrows. Repair structured issues, up to three total attempts.";
export const StudioBuildGanttInputSchema = toPlaygroundStandardSchema(BuildGanttToolInputSchema);
export const StudioBuildGanttOutputSchema = toPlaygroundStandardSchema(BuildGanttResultSchema);
export function makeStudioGanttToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildGanttResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildGanttToolInput, BuildGanttResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildGantt",
		...options,
	});
}
