import "@tanstack/react-start/server-only";
import {
	BuildErDiagramResultSchema,
	BuildErDiagramToolInputSchema,
	type BuildErDiagramResult,
	type BuildErDiagramToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_ER_TOOL_NAME = "build_er_diagram" as const;
export const STUDIO_BUILD_ER_TOOL_DESCRIPTION =
	'Build and persist a native ER diagram: entities drawn as tables of fields with PK, FK and UK markers, and relationships with a cardinality at each end ("one", "zero-or-one", "many", "one-or-many" or "zero-or-many") drawn as crow\'s-foot lines between the rows they join. Fields may be strings "name type markers"; relationship ends are "entity.field" or an entity id. The host lays out the tables. Repair structured issues, up to three total attempts.';
export const StudioBuildErInputSchema = toPlaygroundStandardSchema(BuildErDiagramToolInputSchema);
export const StudioBuildErOutputSchema = toPlaygroundStandardSchema(BuildErDiagramResultSchema);
export function makeStudioErToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildErDiagramResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildErDiagramToolInput, BuildErDiagramResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildErDiagram",
		...options,
	});
}
