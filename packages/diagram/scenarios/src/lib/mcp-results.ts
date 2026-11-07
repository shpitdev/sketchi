import {
	decodeFlowchartDocument,
	flowchartDiagramFromDocument,
	type MindmapTopicTree,
	mindmapDiagramFromTree,
} from "@sketchi/diagram-core";
import { Result } from "effect";

import type { DiagramScenario } from "./diagram-scenarios.js";
import type { ScenarioCheck } from "./evaluate.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Pre-ID failures have no build markers. Only a matching receipt establishes provenance.
function matchesRejectedReceipt(
	returned: Record<string, unknown>,
	receipt: Record<string, unknown>,
): boolean {
	if (
		returned.ok !== false ||
		receipt.ok !== false ||
		returned.status !== receipt.status ||
		!Array.isArray(returned.issues) ||
		returned.issues.length === 0
	)
		return false;
	try {
		return JSON.stringify(returned.issues) === JSON.stringify(receipt.issues);
	} catch {
		return false;
	}
}

/** Prefer a returned build's matching receipt; otherwise use the last attempt, not success. */
export function buildResultFromMcp(
	value: Record<string, unknown>,
	diagramType?: DiagramScenario["diagramType"],
): Record<string, unknown> {
	if (value.ok === false || value.isError === true) return value;
	if (isRecord(value.structuredContent))
		return buildResultFromMcp(value.structuredContent, diagramType);
	if (isRecord(value.normalizedSpec) || typeof value.buildId === "string") return value;
	const returned = isRecord(value.result)
		? buildResultFromMcp(value.result, diagramType)
		: undefined;
	const operation =
		diagramType === "gantt"
			? "buildGantt"
			: diagramType === "chart"
				? "buildChart"
				: diagramType === "timeline"
					? "buildTimeline"
					: diagramType === "sequence"
						? "buildSequenceDiagram"
						: diagramType === "state-machine"
							? "buildStateMachine"
							: diagramType === "mindmap"
								? "buildMindmap"
								: diagramType === "er"
									? "buildErDiagram"
									: diagramType === "class"
										? "buildClassDiagram"
										: diagramType === "org-chart"
											? "buildOrgChart"
											: diagramType === "venn"
												? "buildVennDiagram"
												: diagramType === "journey"
													? "buildJourneyMap"
													: diagramType === "sankey"
														? "buildSankey"
														: diagramType === "wireframe"
															? "buildWireframe"
															: diagramType === "quadrant"
																? "buildQuadrantChart"
																: "buildFlowchart";
	const receipts = Array.isArray(value.builds)
		? value.builds.filter(
				(build): build is Record<string, unknown> =>
					isRecord(build) && (diagramType === undefined || build.operation === operation),
			)
		: [];
	// Scripts may return a lossy summary. The same build's receipt retains its
	// normalized spec and full quality verdict, including rejected attempts.
	const matchingReceipt =
		typeof returned?.buildId === "string"
			? receipts.findLast((receipt) => receipt.buildId === returned.buildId)
			: undefined;
	if (matchingReceipt) return matchingReceipt;
	if (
		returned &&
		(isRecord(returned.normalizedSpec) ||
			typeof returned.buildId === "string" ||
			(typeof returned.operation === "string" &&
				[
					"buildFlowchart",
					"buildMindmap",
					"buildSequenceDiagram",
					"buildTimeline",
					"buildChart",
					"buildStateMachine",
					"buildGantt",
					"buildErDiagram",
					"buildClassDiagram",
					"buildOrgChart",
					"buildOrgChart",
					"buildVennDiagram",
					"buildJourneyMap",
					"buildSankey",
					"buildWireframe",
					"buildQuadrantChart",
					"createCanvas",
				].includes(returned.operation)))
	)
		return returned;
	const explicitRejection = returned
		? receipts.findLast((receipt) => matchesRejectedReceipt(returned, receipt))
		: undefined;
	if (explicitRejection) return explicitRejection;
	const receipt = receipts.at(-1);
	return isRecord(receipt) ? receipt : (returned ?? value);
}

/** Extract the build spec from a build, execute payload, or MCP tool result. */
export function normalizedSpecFrom(value: unknown): unknown {
	if (!isRecord(value)) return undefined;
	const build = buildResultFromMcp(value);
	return isRecord(build.normalizedSpec) ? build.normalizedSpec : undefined;
}

/**
 * Groups take no authored logo. A build draws one before a group whose label
 * names it and notes that as an `icon_filled` issue on the group (see
 * fillGroupLogos in the diagram agent): group id to the logo it drew.
 */
function filledGroupLogos(build: Record<string, unknown>): ReadonlyMap<string, string> {
	const logos = new Map<string, string>();
	for (const issue of Array.isArray(build.issues) ? build.issues : []) {
		if (
			!isRecord(issue) ||
			issue.code !== "icon_filled" ||
			!isRecord(issue.ref) ||
			issue.ref.kind !== "group" ||
			typeof issue.ref.id !== "string" ||
			typeof issue.message !== "string"
		)
			continue;
		const slug = /\bdraws the "([^"]+)" logo\b/u.exec(issue.message)?.[1];
		if (slug) logos.set(issue.ref.id, slug);
	}
	return logos;
}

/**
 * Build a flowchart document as Sketchi draws it: each node's logo is the slug its
 * normalized icon names, and each group draws the logo `groupLogos` gives it by id.
 * A document that does not build is returned as is, for the parse to reject.
 */
export function specToFlowchartCandidate(
	spec: unknown,
	groupLogos: ReadonlyMap<string, string> = new Map(),
): unknown {
	if (!isRecord(spec)) return spec;
	const decoded = decodeFlowchartDocument(spec);
	if (!Result.isSuccess(decoded)) return spec;
	const document = decoded.success;
	const nodeIcons = new Map(
		Object.entries(document.nodes).flatMap(([id, node]) =>
			typeof node !== "string" && typeof node.icon === "string" ? [[id, node.icon] as const] : [],
		),
	);
	const built = flowchartDiagramFromDocument(document, { nodeIcons, groupIcons: groupLogos });
	if (!built.ok) {
		throw new Error(
			`The flowchart document does not build: ${built.issues.map((issue) => issue.message).join(" ")}`,
		);
	}
	return built.diagram;
}

/** Map a Code Mode mindmap's nested topics to the canonical mindmap IR. */
export function specToMindmapCandidate(spec: unknown): unknown {
	if (!isRecord(spec) || !isRecord(spec.root)) return spec;
	const layout = isRecord(spec.layout) ? spec.layout : {};
	return mindmapDiagramFromTree({
		id: typeof spec.id === "string" ? spec.id : "mindmap",
		title: typeof spec.title === "string" ? spec.title : "Mindmap",
		root: spec.root as unknown as MindmapTopicTree,
		...(layout.direction === "RL" ? { direction: "RL" as const } : {}),
	});
}

/** Sequence normalized specs already carry canonical participants and messages. */
export function specToSequenceCandidate(spec: unknown): unknown {
	if (!isRecord(spec)) return spec;
	return {
		id: spec.id,
		title: spec.title,
		type: "sequence",
		participants: spec.participants,
		messages: spec.messages,
		style: spec.style,
	};
}

const operationFamilies: Readonly<Record<string, string>> = {
	buildFlowchart: "flowchart",
	buildMindmap: "mindmap",
	buildSequenceDiagram: "sequence",
	buildTimeline: "timeline",
	buildChart: "chart",
	buildStateMachine: "state-machine",
	buildGantt: "gantt",
	buildErDiagram: "er",
	buildClassDiagram: "class",
	buildOrgChart: "org-chart",
	buildVennDiagram: "venn",
	buildJourneyMap: "journey",
	buildSankey: "sankey",
	buildWireframe: "wireframe",
	buildQuadrantChart: "quadrant",
	createCanvas: "canvas",
};

/** The family a build produced, from its operation or, failing that, a canvas spec. */
function builtDiagramType(
	build: Record<string, unknown>,
	spec: Record<string, unknown>,
): { readonly family: string; readonly label: string } | undefined {
	const operation = typeof build.operation === "string" ? build.operation : undefined;
	const family =
		operation && Object.hasOwn(operationFamilies, operation)
			? operationFamilies[operation]
			: undefined;
	if (operation && family) return { family, label: operation };
	if (spec.kind === "canvas") return { family: "canvas", label: "a canvas spec" };
	return undefined;
}

type McpScenarioCandidate =
	| { readonly ok: true; readonly diagram: unknown; readonly check: ScenarioCheck }
	| { readonly ok: false; readonly check: ScenarioCheck };

function rejected(message: string): McpScenarioCandidate {
	return { ok: false, check: { id: "mcp-build-accepted", passed: false, message } };
}

function failureDetails(value: Record<string, unknown>): string {
	const error =
		typeof value.error === "string"
			? value.error
			: isRecord(value.error) && typeof value.error.message === "string"
				? value.error.message
				: undefined;
	const issues = Array.isArray(value.issues)
		? value.issues.flatMap((issue) =>
				isRecord(issue) && typeof issue.message === "string" ? [issue.message] : [],
			)
		: [];
	const content = Array.isArray(value.content)
		? value.content.flatMap((entry) =>
				isRecord(entry) && entry.type === "text" && typeof entry.text === "string"
					? [entry.text]
					: [],
			)
		: [];
	return [error, ...issues, ...content].filter(Boolean).join(" ");
}

/**
 * Recognize MCP/build inputs without changing the existing bare IR/envelope path.
 * An execute success does not imply its nested build was accepted.
 */
export function candidateFromMcpResult(
	value: unknown,
	diagramType: DiagramScenario["diagramType"],
): McpScenarioCandidate | undefined {
	if (
		!isRecord(value) ||
		![
			"structuredContent",
			"builds",
			"result",
			"normalizedSpec",
			"ok",
			"status",
			"logs",
			"buildId",
			"isError",
			"content",
		].some((key) => key in value)
	) {
		return undefined;
	}
	const build = buildResultFromMcp(value, diagramType);
	if (build.ok === false || build.isError === true) {
		return rejected(
			`MCP execute/build failed${typeof build.status === "string" ? ` (${build.status})` : ""}. ${failureDetails(build)}`.trim(),
		);
	}
	if (
		build.ok !== true ||
		build.status !== "accepted" ||
		(isRecord(build.quality) && build.quality.accepted === false)
	) {
		return rejected(
			`MCP build was not accepted (status: ${typeof build.status === "string" ? build.status : "missing"}). ${failureDetails(build)}`.trim(),
		);
	}
	if (!isRecord(build.normalizedSpec)) {
		return rejected("MCP build has no normalizedSpec object to grade.");
	}
	const builtType = builtDiagramType(build, build.normalizedSpec);
	if (builtType && builtType.family !== diagramType) {
		// A well-formed build of another family is a wrong answer, not ungradable
		// input; its spec cannot be scored by this scenario's checks.
		return {
			ok: false,
			check: {
				id: "diagram-type",
				passed: false,
				message: `Expected native ${diagramType}, got ${builtType.label}.`,
			},
		};
	}
	return {
		ok: true,
		diagram:
			diagramType === "gantt"
				? { ...build.normalizedSpec, type: "gantt" }
				: diagramType === "chart"
					? { ...build.normalizedSpec, type: "chart" }
					: diagramType === "timeline"
						? { ...build.normalizedSpec, type: "timeline" }
						: diagramType === "state-machine" ||
							  diagramType === "er" ||
							  diagramType === "class" ||
							  diagramType === "org-chart" ||
							  diagramType === "venn" ||
							  diagramType === "journey" ||
							  diagramType === "sankey" ||
							  diagramType === "wireframe" ||
							  diagramType === "quadrant"
							? { ...build.normalizedSpec, type: diagramType }
							: diagramType === "mindmap"
								? specToMindmapCandidate(build.normalizedSpec)
								: diagramType === "sequence"
									? specToSequenceCandidate(build.normalizedSpec)
									: specToFlowchartCandidate(build.normalizedSpec, filledGroupLogos(build)),
		check: {
			id: "mcp-build-accepted",
			passed: true,
			message: "MCP build was accepted and returned a normalizedSpec.",
		},
	};
}
