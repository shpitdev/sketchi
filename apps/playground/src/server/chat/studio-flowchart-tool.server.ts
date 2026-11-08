import "@tanstack/react-start/server-only";

import {
	BuildFlowchartRequestSchema,
	BuildFlowchartResultSchema,
	DIAGRAM_AGENT_SYSTEM_PROMPT,
	type BuildFlowchartResult,
	type BuildFlowchartToolInput,
	type CodeModeIssue,
	normalizeIconSlug,
} from "@sketchi/diagram-agent";
import { placeNodeLogos, type OfferedLogo } from "@sketchi/diagram-generation";
import type { Effect } from "effect";

import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import { makeStudioBuildToolExecutor, type StudioBuildTurn } from "./studio-build-tool.server";

export const STUDIO_BUILD_FLOWCHART_TOOL_NAME = "build_flowchart" as const;

export const STUDIO_BUILD_FLOWCHART_TOOL_DESCRIPTION =
	"Build and persist one canonical flowchart artifact. Pass { spec } with the flowchart document: nodes as { id: label }, edges as [from, to, label?], optional groups and lanes that list what they contain. The host supplies artifact options. If rejected, repair every structured issue and retry, up to three total attempts.";

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
		"- In a flowchart, set logos: true and keep each technology's name in its node label; the logo follows the label.",
		`- When a sequence participant is about one of these technologies, set its icon to { "slug": "<slug>" } with a slug from this list exactly, and keep the technology's name in its label. Leave icon off every other participant. Never invent a slug.`,
	].join("\n");
}

/**
 * Only the technologies the user named draw: a node icon naming another is
 * dropped before the build. With logos on, each bare node is settled here too,
 * to the named logo its label names or to none, so the build fills no logo the
 * user never named.
 */
function groundSpecIcons(
	input: StudioBuildFlowchartInput,
	logos: readonly OfferedLogo[],
): {
	readonly input: StudioBuildFlowchartInput;
	readonly issues: CodeModeIssue[];
} {
	const offered = new Set(logos.map((logo) => logo.slug));
	const fills = Boolean(input.spec.logos);
	const issues: CodeModeIssue[] = [];
	const bare = Object.entries(input.spec.nodes).flatMap(
		([id, node]): { id: string; label: string; icon?: { slug: string } }[] =>
			typeof node === "string"
				? [{ id, label: node }]
				: node.icon === undefined
					? [{ id, label: node.label }]
					: [],
	);
	const fromLabels = new Map(
		fills
			? placeNodeLogos(bare, logos).nodes.flatMap((node) =>
					node.icon ? [[node.id, node.icon.slug] as const] : [],
				)
			: [],
	);
	let changed = false;
	const nodes = Object.fromEntries(
		Object.entries(input.spec.nodes).map(([id, node]) => {
			const details = typeof node === "string" ? { label: node } : node;
			if (typeof details.icon !== "string") {
				if (!fills || details.icon === null) return [id, node];
				changed = true;
				return [id, { ...details, icon: fromLabels.get(id) ?? null }];
			}
			if (offered.has(normalizeIconSlug(details.icon))) return [id, node];
			changed = true;
			issues.push({
				code: "unknown_icon",
				severity: "warning",
				stage: "input",
				ref: { kind: "node", id, path: `nodes.${id}.icon` },
				message: `Icon "${details.icon}" on node "${id}" is not a technology the user named; the node renders without a logo.`,
				hint: "Only use logos from the NODE LOGOS list.",
			});
			const { icon: _icon, ...rest } = details;
			return [id, fills ? { ...rest, icon: null } : rest];
		}),
	);
	return changed
		? { input: { ...input, spec: { ...input.spec, nodes } }, issues }
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
