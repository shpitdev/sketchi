import "@tanstack/react-start/server-only";

import {
	BuildFlowchartRequestSchema,
	BuildFlowchartResultSchema,
	DIAGRAM_AGENT_SYSTEM_PROMPT,
	normalizeIconSlug,
	type BuildFlowchartResult,
	type BuildFlowchartToolInput,
	type CodeModeIssue,
} from "@sketchi/diagram-agent";
import { placeNodeLogos, type OfferedLogo } from "@sketchi/diagram-generation";
import type { Effect } from "effect";

import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

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
		'- When a node is about one of these technologies, set its icon to { "slug": "<slug>" } with a slug from this list exactly. Leave icon off every other node. Never invent a slug.',
	].join("\n");
}

/**
 * Place the user's named logos on the nodes whose labels name them and drop
 * logos for technologies the user never named, before the build.
 */
function groundSpecIcons(
	input: StudioBuildFlowchartInput,
	logos: readonly OfferedLogo[],
): {
	readonly input: StudioBuildFlowchartInput;
	readonly issues: CodeModeIssue[];
} {
	const offered = new Set(logos.map((logo) => logo.slug));
	const issues: CodeModeIssue[] = input.spec.nodes.flatMap((node) =>
		node.icon && !offered.has(normalizeIconSlug(node.icon.slug))
			? [
					{
						code: "unknown_icon" as const,
						severity: "warning" as const,
						stage: "input" as const,
						ref: {
							kind: "node" as const,
							id: node.id,
							path: "nodes.icon.slug",
						},
						message: `Icon "${node.icon.slug}" on node "${node.id}" is not a technology the user named; the node renders without a logo.`,
						hint: "Only use logos from the NODE LOGOS list.",
					},
				]
			: [],
	);
	const placement = placeNodeLogos(
		input.spec.nodes.map((node) =>
			node.icon ? { ...node, icon: { slug: normalizeIconSlug(node.icon.slug) } } : node,
		),
		logos,
	);
	return placement.diagnostics.length > 0 || issues.length > 0
		? {
				input: { ...input, spec: { ...input.spec, nodes: placement.nodes } },
				issues,
			}
		: { input, issues };
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
