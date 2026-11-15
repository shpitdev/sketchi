import {
	FLOWCHART_REQUEST_MAX_LENGTH,
	type BuildFlowchartResult,
	type BuildFlowchartToolInput,
	type BuildSequenceDiagramResult,
	type BuildSequenceDiagramToolInput as StudioBuildSequenceInput,
} from "@sketchi/diagrams/build/code-mode/contract";
import "@tanstack/react-start/server-only";

import { normalizeIconSlug } from "@sketchi/diagrams/build/code-mode/icons";
import { type CodeModeIssue } from "@sketchi/diagrams/build/result";
import { placeNodeLogos, type OfferedLogo } from "@sketchi/diagrams/generate/logo-placement";
import { type Effect } from "effect";

import {
	groundOfferedLogos,
	makeStudioBuildToolExecutor,
	type StudioBuildTurn,
} from "./studio-build-tool.server";

export type StudioBuildFlowchartInput = BuildFlowchartToolInput;

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

/** Studio has no editFlowchart: a build that misses what the request states is fixed by one more build. */
export const STUDIO_COVERAGE_HINT =
	"Call build_flowchart once more with the complete spec, fixing this, before you answer.";
/** Once that build is spent, the diagram stands as it is. */
export const STUDIO_COVERAGE_FINAL_HINT =
	"No build is left this turn: answer with this diagram, and tell the user what it still misses.";

const missesRequest = (result: BuildFlowchartResult) =>
	result.ok && result.issues.some((issue) => issue.stage === "coverage");

const withCoverageHint =
	(hint: string) =>
	(result: BuildFlowchartResult): BuildFlowchartResult => ({
		...result,
		issues: result.issues.map((issue) => (issue.stage === "coverage" ? { ...issue, hint } : issue)),
	});

/**
 * Studio's build_flowchart tool over the shared buildFlowchart vertical. Each build is checked
 * against the user's latest message as its request, so an accepted flowchart that misses what
 * it states may be rebuilt once in the same turn.
 */
export function makeStudioFlowchartToolExecutor<E, R>(
	buildFlowchart: (input: unknown) => Effect.Effect<BuildFlowchartResult, E, R>,
	options: {
		readonly logos?: readonly OfferedLogo[];
		/** The user's latest message. */
		readonly request?: string;
		readonly turn?: StudioBuildTurn;
	} = {},
) {
	const logos = options.logos ?? [];
	const request = options.request?.trim().slice(0, FLOWCHART_REQUEST_MAX_LENGTH);
	return makeStudioBuildToolExecutor<StudioBuildFlowchartInput, BuildFlowchartResult, E, R>({
		build: (input) => buildFlowchart(request ? { ...(input as object), request } : input),
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => groundSpecIcons(input, logos),
		reopen: {
			misses: missesRequest,
			open: withCoverageHint(STUDIO_COVERAGE_HINT),
			closed: withCoverageHint(STUDIO_COVERAGE_FINAL_HINT),
		},
		operation: "buildFlowchart",
		...(options.turn ? { turn: options.turn } : {}),
	});
}

/** Studio's build_sequence_diagram tool over the shared buildSequenceDiagram vertical. */
export function makeStudioSequenceToolExecutor<E, R>(
	buildSequenceDiagram: (input: unknown) => Effect.Effect<BuildSequenceDiagramResult, E, R>,
	options: { readonly logos?: readonly OfferedLogo[]; readonly turn?: StudioBuildTurn } = {},
) {
	const logos = options.logos ?? [];
	return makeStudioBuildToolExecutor<StudioBuildSequenceInput, BuildSequenceDiagramResult, E, R>({
		build: buildSequenceDiagram,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
		ground: (input) => {
			const grounded = groundOfferedLogos(input.spec.participants, logos, {
				noun: "participant",
				path: "participants",
			});
			return grounded.changed
				? {
						input: { ...input, spec: { ...input.spec, participants: grounded.elements } },
						issues: grounded.issues,
					}
				: { input, issues: grounded.issues };
		},
		operation: "buildSequenceDiagram",
		...(options.turn ? { turn: options.turn } : {}),
	});
}
