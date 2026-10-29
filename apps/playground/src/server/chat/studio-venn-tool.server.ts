import "@tanstack/react-start/server-only";
import {
	BuildVennDiagramResultSchema,
	BuildVennDiagramToolInputSchema,
	type BuildVennDiagramResult,
	type BuildVennDiagramToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_VENN_TOOL_NAME = "build_venn_diagram" as const;
export const STUDIO_BUILD_VENN_TOOL_DESCRIPTION =
	'Build and persist a native Venn diagram: two or three equal, overlapping translucent circles, each set\'s label outside its circle, and each region\'s items or count inside exactly that region. Give sets: [{ id, label }] and regions: [{ sets, items }], one region per overlap: ["a"] is a only, ["a", "b"] is a and b but not c. A region holds items or a count; omit empty regions. The host lays out the circles and sizes them to fit. Repair structured issues, up to three total attempts.';
export const StudioBuildVennInputSchema = toPlaygroundStandardSchema(
	BuildVennDiagramToolInputSchema,
);
export const StudioBuildVennOutputSchema = toPlaygroundStandardSchema(BuildVennDiagramResultSchema);
export function makeStudioVennToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildVennDiagramResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildVennDiagramToolInput, BuildVennDiagramResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildVennDiagram",
		...options,
	});
}
