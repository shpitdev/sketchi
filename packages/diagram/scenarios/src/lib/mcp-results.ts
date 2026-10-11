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

/** Prefer an explicit build; otherwise use the last matching attempt, not the last success. */
function buildFrom(
	value: Record<string, unknown>,
	diagramType?: DiagramScenario["diagramType"],
): Record<string, unknown> {
	if (value.ok === false || value.isError === true) return value;
	if (isRecord(value.structuredContent)) return buildFrom(value.structuredContent, diagramType);
	if (isRecord(value.normalizedSpec) || typeof value.buildId === "string") return value;
	const returned = isRecord(value.result) ? buildFrom(value.result, diagramType) : undefined;
	if (
		returned &&
		(isRecord(returned.normalizedSpec) ||
			typeof returned.buildId === "string" ||
			(typeof returned.operation === "string" &&
				["buildFlowchart", "buildMindmap", "buildSequenceDiagram", "createCanvas"].includes(
					returned.operation,
				)))
	)
		return returned;
	const operation = diagramType === "sequence" ? "buildSequenceDiagram" : "buildFlowchart";
	const receipts = Array.isArray(value.builds)
		? value.builds.filter(
				(build): build is Record<string, unknown> =>
					isRecord(build) && (diagramType === undefined || build.operation === operation),
			)
		: [];
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
	const build = buildFrom(value);
	return isRecord(build.normalizedSpec) ? build.normalizedSpec : undefined;
}

function cleanEdgeId(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	let cleaned = value.trim();
	try {
		const parsed: unknown = JSON.parse(cleaned);
		if (typeof parsed === "string") cleaned = parsed.trim();
	} catch {
		// Unquoted ids are already strings.
	}
	for (;;) {
		const next = cleaned
			.replace(
				/[,;]\s*(?:id|label|kind|group|source|target|title|direction|nodes|edges)\s*:?\s*$/i,
				"",
			)
			.trim();
		if (next === cleaned) return cleaned || undefined;
		cleaned = next;
	}
}

/** Map the Code Mode authoring layout to the canonical flowchart IR. */
export function specToFlowchartCandidate(spec: unknown): unknown {
	if (!isRecord(spec)) return spec;
	const layout = isRecord(spec.layout) ? spec.layout : {};
	return {
		id: spec.id,
		title: spec.title,
		type: "flowchart",
		nodes: spec.nodes,
		edges: Array.isArray(spec.edges)
			? spec.edges.map((edge, index) =>
					isRecord(edge) ? { ...edge, id: cleanEdgeId(edge.id) ?? `edge-${index + 1}` } : edge,
				)
			: spec.edges,
		layout: { direction: layout.direction ?? "TB", edgeRouting: "orthogonal" },
		style: spec.style,
	};
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
	const build = buildFrom(value, diagramType);
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
	return {
		ok: true,
		diagram:
			diagramType === "sequence"
				? specToSequenceCandidate(build.normalizedSpec)
				: specToFlowchartCandidate(build.normalizedSpec),
		check: {
			id: "mcp-build-accepted",
			passed: true,
			message: "MCP build was accepted and returned a normalizedSpec.",
		},
	};
}
