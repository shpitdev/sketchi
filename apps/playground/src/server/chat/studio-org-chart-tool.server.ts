import "@tanstack/react-start/server-only";
import {
	BuildOrgChartResultSchema,
	BuildOrgChartToolInputSchema,
	type BuildOrgChartResult,
	type BuildOrgChartToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_ORG_CHART_TOOL_NAME = "build_org_chart" as const;
export const STUDIO_BUILD_ORG_CHART_TOOL_DESCRIPTION =
	"Build and persist a native org chart: one card per person with their name, title and department, each manager above the reports they lead, long lists of reports stacked in columns, assistants beside their manager, and dotted-line (matrix) reports dashed. Give each person an id, name and manager (the id they report to; only the top person has none), with optional title, department, assistant: true and avatar: true; add dottedLines: [{ report, manager }] for secondary reports and groupByDepartment: true for department regions. The host lays out the chart. Repair structured issues, up to three total attempts.";
export const StudioBuildOrgChartInputSchema = toPlaygroundStandardSchema(
	BuildOrgChartToolInputSchema,
);
export const StudioBuildOrgChartOutputSchema =
	toPlaygroundStandardSchema(BuildOrgChartResultSchema);
export function makeStudioOrgChartToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildOrgChartResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildOrgChartToolInput, BuildOrgChartResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildOrgChart",
		...options,
	});
}
