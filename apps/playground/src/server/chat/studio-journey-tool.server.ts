import "@tanstack/react-start/server-only";
import {
	BuildJourneyMapResultSchema,
	BuildJourneyMapToolInputSchema,
	type BuildJourneyMapResult,
	type BuildJourneyMapToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_JOURNEY_MAP_TOOL_NAME = "build_journey_map" as const;
export const STUDIO_BUILD_JOURNEY_MAP_TOOL_DESCRIPTION =
	"Build and persist a native user journey map: stages as columns across the top, each step's card under its stage, an emotion curve through a face per step at its score, and each stage's pain points and opportunities beneath it. Give stages in order, each { name, steps: [{ label, score, actor?, touchpoint? }], painPoints?, opportunities? }; score is a whole number from 1 (very negative) to 5 (very positive), 3 neutral. Add persona when the user names whose journey it is. The host lays out the map. Repair structured issues, up to three total attempts.";
export const StudioBuildJourneyMapInputSchema = toPlaygroundStandardSchema(
	BuildJourneyMapToolInputSchema,
);
export const StudioBuildJourneyMapOutputSchema = toPlaygroundStandardSchema(
	BuildJourneyMapResultSchema,
);
export function makeStudioJourneyMapToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildJourneyMapResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildJourneyMapToolInput, BuildJourneyMapResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildJourneyMap",
		...options,
	});
}
