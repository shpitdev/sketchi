import "@tanstack/react-start/server-only";
import {
	BuildClassDiagramResultSchema,
	BuildClassDiagramToolInputSchema,
	type BuildClassDiagramResult,
	type BuildClassDiagramToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_CLASS_TOOL_NAME = "build_class_diagram" as const;
export const STUDIO_BUILD_CLASS_TOOL_DESCRIPTION =
	'Build and persist a native UML class diagram: classes, interfaces and enums drawn as boxes of name, attributes and methods, superclasses above their subclasses, and relationships drawn with their UML heads: inheritance and realization (from extends or implements to) with hollow triangles, composition and aggregation (from is the whole) with filled and hollow diamonds, association (navigable: true adds an arrow) and dependency (dashed arrow). Members may be strings "- name: Type" and "+ name(p: Type): Return"; associations, compositions and aggregations take multiplicities and roles at each end. The host lays out the boxes. Repair structured issues, up to three total attempts.';
export const StudioBuildClassInputSchema = toPlaygroundStandardSchema(
	BuildClassDiagramToolInputSchema,
);
export const StudioBuildClassOutputSchema = toPlaygroundStandardSchema(
	BuildClassDiagramResultSchema,
);
export function makeStudioClassToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildClassDiagramResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildClassDiagramToolInput, BuildClassDiagramResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildClassDiagram",
		...options,
	});
}
