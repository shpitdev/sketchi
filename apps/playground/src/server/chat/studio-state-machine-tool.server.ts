import "@tanstack/react-start/server-only";
import {
	BuildStateMachineResultSchema,
	BuildStateMachineToolInputSchema,
	type BuildStateMachineResult,
	type BuildStateMachineToolInput,
} from "@sketchi/diagram-agent";
import type { Effect } from "effect";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";
export const STUDIO_BUILD_STATE_MACHINE_TOOL_NAME = "build_state_machine" as const;
export const STUDIO_BUILD_STATE_MACHINE_TOOL_DESCRIPTION =
	'Build and persist a native state machine: states, the initial state, and transitions labeled by event, guard and action. kind "final" ends the machine, kind "choice" branches on guards, and a state named as parent groups its substates into a composite with its own initial. Transitions may enter or leave a composite or return to their own state. The host lays out the machine. Repair structured issues, up to three total attempts.';
export const StudioBuildStateMachineInputSchema = toPlaygroundStandardSchema(
	BuildStateMachineToolInputSchema,
);
export const StudioBuildStateMachineOutputSchema = toPlaygroundStandardSchema(
	BuildStateMachineResultSchema,
);
export function makeStudioStateMachineToolExecutor<E, R>(
	build: (input: unknown) => Effect.Effect<BuildStateMachineResult, E, R>,
	options: { readonly turn?: StudioBuildTurn } = {},
) {
	return makeStudioBuildToolExecutor<BuildStateMachineToolInput, BuildStateMachineResult, E, R>({
		build,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => ({ input, issues: [] }),
		operation: "buildStateMachine",
		...options,
	});
}
