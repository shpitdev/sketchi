import "@tanstack/react-start/server-only";
import {
	BuildChartResultSchema,
	BuildChartToolInputSchema,
	type BuildChartResult,
	type BuildChartToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";
export const STUDIO_BUILD_CHART_TOOL_NAME = "build_chart" as const;
export const STUDIO_BUILD_CHART_TOOL_DESCRIPTION =
	"Build and persist a native bar, line or pie chart from categories and named series of numbers. Copy every number, unit and axis title from the user, invent none. One value per category in every series; a pie has one series. The host draws axes, ticks, labels and legend. Repair structured issues, up to three total attempts.";
export const StudioBuildChartInputSchema = toPlaygroundStandardSchema(BuildChartToolInputSchema);
export const StudioBuildChartOutputSchema = toPlaygroundStandardSchema(BuildChartResultSchema);
export function makeStudioChartToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildChartResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildChartToolInput, BuildChartResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildChart",
		...options,
	});
}
