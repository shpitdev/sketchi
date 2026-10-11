import "@tanstack/react-start/server-only";

import {
	BuildSequenceDiagramResultSchema,
	BuildSequenceDiagramToolInputSchema,
	type BuildSequenceDiagramResult,
	type BuildSequenceDiagramToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";

import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_SEQUENCE_TOOL_NAME = "build_sequence_diagram" as const;

export const STUDIO_BUILD_SEQUENCE_TOOL_DESCRIPTION =
	"Build and persist one canonical sequence diagram artifact. Pass { spec: SequenceDiagramSpec } with ordered participants and chronological messages; the host supplies artifact options. If rejected, repair every structured issue and retry, up to three total attempts.";

export const StudioBuildSequenceInputSchema = toPlaygroundStandardSchema(
	BuildSequenceDiagramToolInputSchema,
);
export const StudioBuildSequenceOutputSchema = toPlaygroundStandardSchema(
	BuildSequenceDiagramResultSchema,
);

export type StudioBuildSequenceInput = BuildSequenceDiagramToolInput;

/** Studio's build_sequence_diagram tool over the shared buildSequenceDiagram vertical. */
export function makeStudioSequenceToolExecutor<E, R>(
	buildSequenceDiagram: (input: unknown) => Effect.Effect<BuildSequenceDiagramResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<StudioBuildSequenceInput, BuildSequenceDiagramResult, E, R>({
		build: buildSequenceDiagram,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		operation: "buildSequenceDiagram",
		...(options.turn ? { turn: options.turn } : {}),
	});
}
