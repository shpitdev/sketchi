import "@tanstack/react-start/server-only";

import {
	BuildFlowchartRequestSchema,
	BuildFlowchartResultSchema,
	DIAGRAM_AGENT_SYSTEM_PROMPT,
	type BuildFlowchartResult,
	type BuildFlowchartToolInput,
	type CodeModeIssue,
} from "@sketchi/diagram-agent";
import type { OfferedLogo } from "@sketchi/diagram-generation";
import type { Effect } from "effect";

import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import {
	groundOfferedLogos,
	makeStudioBuildToolExecutor,
	type StudioBuildTurn,
} from "./studio-build-tool.server";

export const STUDIO_BUILD_FLOWCHART_TOOL_NAME = "build_flowchart" as const;

export const STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION =
	"Build and persist one canonical flowchart artifact. Pass { spec: FlowchartSpec }; the host supplies artifact options. If rejected, repair every structured issue and retry, up to three total attempts.";

export const StudioBuildFlowchartInputSchema = toPlaygroundStandardSchema(
	BuildFlowchartRequestSchema.omit({ options: true }),
);
export const StudioBuildFlowchartOutputSchema = toPlaygroundStandardSchema(
	BuildFlowchartResultSchema,
);

export type StudioBuildFlowchartInput = BuildFlowchartToolInput;

/**
 * Studio's system prompt, plus the logos the user named. The model may only use
 * those slugs; anything else is dropped before the build.
 */
export function studioSystemPrompt(
	logos: readonly { readonly name: string; readonly slug: string }[],
): string {
	if (logos.length === 0) return DIAGRAM_AGENT_SYSTEM_PROMPT;
	return [
		DIAGRAM_AGENT_SYSTEM_PROMPT,
		"",
		"NODE LOGOS",
		`- Logos for technologies the user named: ${logos
			.map((logo) => `${logo.slug} (${logo.name})`)
			.join(", ")}.`,
		'- When a flowchart node or sequence participant is about one of these technologies, set its icon to { "slug": "<slug>" } with a slug from this list exactly. Leave icon off every other node and participant. Never invent a slug.',
	].join("\n");
}

function groundSpecIcons(
	input: StudioBuildFlowchartInput,
	logos: readonly OfferedLogo[],
): {
	readonly input: StudioBuildFlowchartInput;
	readonly issues: CodeModeIssue[];
} {
	const grounded = groundOfferedLogos(input.spec.nodes, logos, { noun: "node", path: "nodes" });
	return grounded.changed
		? {
				input: { ...input, spec: { ...input.spec, nodes: grounded.elements } },
				issues: grounded.issues,
			}
		: { input, issues: grounded.issues };
}

/** Studio's build_flowchart tool over the shared buildFlowchart vertical. */
export function makeStudioFlowchartToolExecutor<E, R>(
	buildFlowchart: (input: unknown) => Effect.Effect<BuildFlowchartResult, E, R>,
	options: { readonly logos?: readonly OfferedLogo[]; readonly turn?: StudioBuildTurn } = {},
) {
	const logos = options.logos ?? [];
	return makeStudioBuildToolExecutor<StudioBuildFlowchartInput, BuildFlowchartResult, E, R>({
		build: buildFlowchart,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => groundSpecIcons(input, logos),
		operation: "buildFlowchart",
		...(options.turn ? { turn: options.turn } : {}),
	});
}
