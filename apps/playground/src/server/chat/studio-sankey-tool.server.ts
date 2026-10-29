import "@tanstack/react-start/server-only";
import {
	BuildSankeyResultSchema,
	BuildSankeyToolInputSchema,
	type BuildSankeyResult,
	type BuildSankeyToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_SANKEY_TOOL_NAME = "build_sankey" as const;
export const STUDIO_BUILD_SANKEY_TOOL_DESCRIPTION =
	"Build and persist a native Sankey diagram of weighted flows: budgets, traffic, funnels with drop-offs, energy or material flows. Give nodes [{ id, label }] and links [{ source, target, value }] with every stated amount (value > 0), an optional label per link, and an optional unit. Links run one way, with no cycles; add no balancing node. The host lays out columns, bars as tall as each node's total and bands as wide as each value, and writes every total and value. Repair structured issues, up to three total attempts.";
export const StudioBuildSankeyInputSchema = toPlaygroundStandardSchema(BuildSankeyToolInputSchema);
export const StudioBuildSankeyOutputSchema = toPlaygroundStandardSchema(BuildSankeyResultSchema);
export function makeStudioSankeyToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildSankeyResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildSankeyToolInput, BuildSankeyResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildSankey",
		...options,
	});
}
