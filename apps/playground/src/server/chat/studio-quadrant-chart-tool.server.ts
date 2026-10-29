import "@tanstack/react-start/server-only";
import {
	BuildQuadrantChartResultSchema,
	BuildQuadrantChartToolInputSchema,
	type BuildQuadrantChartResult,
	type BuildQuadrantChartToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_QUADRANT_CHART_TOOL_NAME = "build_quadrant_chart" as const;
export const STUDIO_BUILD_QUADRANT_CHART_TOOL_DESCRIPTION =
	"Build and persist a native quadrant chart: a square plot split into four tinted, named quadrants, axis arrows carrying their end labels, and each item as a dot at its scores with its label beside it. Give xAxis and yAxis { title, low, high }, quadrants { topLeft, topRight, bottomLeft, bottomRight }, and points [{ label, x, y, group? }] with x and y from 0 (low end) to 1 (high end). The host places every dot and label. Repair structured issues, up to three total attempts.";
export const StudioBuildQuadrantChartInputSchema = toPlaygroundStandardSchema(
	BuildQuadrantChartToolInputSchema,
);
export const StudioBuildQuadrantChartOutputSchema = toPlaygroundStandardSchema(
	BuildQuadrantChartResultSchema,
);
export function makeStudioQuadrantChartToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildQuadrantChartResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildQuadrantChartToolInput, BuildQuadrantChartResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildQuadrantChart",
		...options,
	});
}
