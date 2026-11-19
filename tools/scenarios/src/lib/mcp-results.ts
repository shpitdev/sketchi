import {
	decodeFlowchartDocument,
	flowchartDiagramFromDocument,
} from "@sketchi/diagrams/families/flowchart/document";
import { families, familyForType } from "@sketchi/diagrams/family";

import { Option, Result, Schema } from "effect";

import { type DiagramScenario } from "./diagram-scenarios";
import { type ScenarioCheck } from "./evaluate";

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
	const operation = familyForType(diagramType ?? "flowchart").operation;
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
				(returned.operation === "createCanvas" ||
					families.some((family) => family.operation === returned.operation))))
	)
		return returned;
	const explicitRejection = returned
		? receipts.findLast((receipt) => matchesRejectedReceipt(returned, receipt))
		: undefined;
	if (explicitRejection) return explicitRejection;
	const receipt = receipts.at(-1);
	return isRecord(receipt) ? receipt : (returned ?? value);
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
): Result.Result<unknown, ScenarioMcpCandidateError> {
	if (!isRecord(spec)) return Result.succeed(spec);
	const decoded = decodeFlowchartDocument(spec);
	if (!Result.isSuccess(decoded)) return Result.succeed(spec);
	const document = decoded.success;
	const nodeIcons = new Map(
		Object.entries(document.nodes).flatMap(([id, node]) =>
			typeof node !== "string" && typeof node.icon === "string" ? [[id, node.icon] as const] : [],
		),
	);
	const built = flowchartDiagramFromDocument(document, { nodeIcons, groupIcons: groupLogos });
	if (!built.ok) {
		return Result.fail(
			ScenarioMcpCandidateError.make({
				message: `The flowchart document does not build: ${built.issues.map((issue) => issue.message).join(" ")}`,
			}),
		);
	}
	return Result.succeed(built.diagram);
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

/** The family a build produced, from its operation or, failing that, a canvas spec. */
function builtDiagramType(
	build: Record<string, unknown>,
	spec: Record<string, unknown>,
): { readonly family: string; readonly label: string } | undefined {
	const operation = typeof build.operation === "string" ? build.operation : undefined;
	const family =
		operation === "createCanvas"
			? "canvas"
			: families.find((family) => family.operation === operation)?.type;
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
): Result.Result<Option.Option<McpScenarioCandidate>, ScenarioMcpCandidateError> {
	return Result.gen(function* () {
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
			return Option.none();
		}
		const build = buildResultFromMcp(value, diagramType);
		if (build.ok === false || build.isError === true) {
			return Option.some(
				rejected(
					`MCP execute/build failed${typeof build.status === "string" ? ` (${build.status})` : ""}. ${failureDetails(build)}`.trim(),
				),
			);
		}
		if (
			build.ok !== true ||
			build.status !== "accepted" ||
			(isRecord(build.quality) && build.quality.accepted === false)
		) {
			return Option.some(
				rejected(
					`MCP build was not accepted (status: ${typeof build.status === "string" ? build.status : "missing"}). ${failureDetails(build)}`.trim(),
				),
			);
		}
		if (!isRecord(build.normalizedSpec)) {
			return Option.some(rejected("MCP build has no normalizedSpec object to grade."));
		}
		const builtType = builtDiagramType(build, build.normalizedSpec);
		if (builtType && builtType.family !== diagramType) {
			// A well-formed build of another family is a wrong answer, not ungradable
			// input; its spec cannot be scored by this scenario's checks.
			return Option.some({
				ok: false,
				check: {
					id: "diagram-type",
					passed: false,
					message: `Expected native ${diagramType}, got ${builtType.label}.`,
				},
			});
		}
		return Option.some({
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
									? { ...build.normalizedSpec, type: "mindmap" }
									: diagramType === "sequence"
										? specToSequenceCandidate(build.normalizedSpec)
										: yield* specToFlowchartCandidate(
												build.normalizedSpec,
												filledGroupLogos(build),
											),
			check: {
				id: "mcp-build-accepted",
				passed: true,
				message: "MCP build was accepted and returned a normalizedSpec.",
			},
		});
	});
}

export class ScenarioMcpCandidateError extends Schema.TaggedError<
	ScenarioMcpCandidateError,
	{ readonly brand: unique symbol }
>()("ScenarioMcpCandidateError", { message: Schema.String }) {}
