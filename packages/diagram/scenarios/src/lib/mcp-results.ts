import type { DiagramScenario } from "./diagram-scenarios.js";
import type { ScenarioCheck } from "./evaluate.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Extract the build spec from a build, execute payload, or MCP tool result. */
export function normalizedSpecFrom(value: unknown): unknown {
	if (!isRecord(value)) return undefined;
	if (isRecord(value.normalizedSpec)) return value.normalizedSpec;
	if (isRecord(value.structuredContent)) return normalizedSpecFrom(value.structuredContent);
	if (isRecord(value.result)) return normalizedSpecFrom(value.result);
	return undefined;
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
	let build = value;
	for (;;) {
		if (build.ok === false || build.isError === true) {
			return rejected(
				`MCP execute/build failed${typeof build.status === "string" ? ` (${build.status})` : ""}. ${failureDetails(build)}`.trim(),
			);
		}
		if (isRecord(build.structuredContent)) {
			build = build.structuredContent;
			continue;
		}
		if (isRecord(build.result)) {
			build = build.result;
			continue;
		}
		break;
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
