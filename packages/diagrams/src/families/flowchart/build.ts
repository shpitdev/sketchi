import { inputIssues, formatContractSchemaError } from "../../build/input.js";
/** Owns Flowchart build policy; decoding, quality gates and artifact delivery use the common operation. */
import { Effect, Result, Schema } from "effect";
import { defineBuild } from "../../build/operation.js";
import { CodeModeIssue, qualityIssues } from "../../build/result.js";
import {
	BuildIconSource,
	resolveFlowchartLogos,
	fillGroupLogos,
	embedSceneIcons,
} from "../../build/code-mode/icons.js";
import { checkRequestCoverage, type CoverageIssueCode } from "../../generate/coverage.js";
import { longNodeDescriptions } from "../../graph/compose.js";
import { NODE_DESCRIPTION_MAX_LINES } from "../../graph/measure.js";
import { FLOWCHART_COVERAGE_CODES } from "./coverage-codes.js";
import {
	FlowchartDocumentSchema,
	NormalizedFlowchartSpecSchema,
	FlowchartValidationError,
	FlowchartValidationIssueCodeSchema,
	FLOWCHART_MAX_ISSUES,
	decodeFlowchartDocument,
	normalizeFlowchartSpec,
	flowchartDiagramFromDocument,
	counts,
	type FlowchartDocument,
	type NormalizedFlowchartSpec,
} from "./document.js";
import { assessFlowchartQuality } from "./quality.js";
import { renderFlowchartDiagram } from "./render.js";

export const FLOWCHART_REQUEST_MAX_LENGTH = 20_000;
export const FlowchartRequestText = Schema.NonEmptyString.check(
	Schema.isMaxLength(FLOWCHART_REQUEST_MAX_LENGTH, {
		message: `request must be at most ${FLOWCHART_REQUEST_MAX_LENGTH} characters.`,
	}),
);

function normalize(document: FlowchartDocument) {
	const normalized = normalizeFlowchartSpec(document);
	return normalized.ok
		? Result.succeed(normalized.spec)
		: Result.fail(FlowchartValidationError.fromIssues(normalized.issues));
}

function check(document: NormalizedFlowchartSpec) {
	const built = flowchartDiagramFromDocument(document);
	return built.ok
		? Result.succeed(built.diagram)
		: Result.fail(FlowchartValidationError.fromIssues(built.issues));
}

const coverage = new Set<CoverageIssueCode>(FLOWCHART_COVERAGE_CODES);
const isFlowchartCoverageCode = (
	code: CoverageIssueCode,
): code is (typeof FLOWCHART_COVERAGE_CODES)[number] => coverage.has(code);

export const flowchartBuild = defineBuild({
	name: "flowchart",
	document: FlowchartDocumentSchema,
	normalized: NormalizedFlowchartSpecSchema,
	tool: FlowchartDocumentSchema,
	requestText: FlowchartRequestText,
	error: Schema.Union([FlowchartValidationError, Schema.declare(Schema.isSchemaError)]),
	issueCodes: FlowchartValidationIssueCodeSchema,
	// Coverage diagnostics were already an open code string in the released Flowchart result.
	publishedIssues: CodeModeIssue,
	invalidStatus: "invalid_flowchart",
	inputIssues: (error) => inputIssues(formatContractSchemaError(error)),
	documentStatus: (error) =>
		!Schema.isSchemaError(error) &&
		error.issues.some((entry) => entry.code === "flowchart_too_large")
			? "limit_exceeded"
			: "invalid_flowchart",
	prepare: (input: unknown) => {
		// Agents sometimes put the user's request inside the document. It belongs to this build.
		if (typeof input !== "object" || input === null || !("spec" in input) || "request" in input)
			return Result.succeed(input);
		const spec = input.spec;
		if (
			typeof spec !== "object" ||
			spec === null ||
			!("request" in spec) ||
			typeof spec.request !== "string"
		)
			return Result.succeed(input);
		const { request, ...document } = spec;
		return Result.succeed({ ...input, spec: document, request });
	},
	normalize,
	check,
	counts,
	issues: (error): CodeModeIssue[] =>
		Schema.isSchemaError(error)
			? inputIssues(
					formatContractSchemaError(error),
					() =>
						"Give every title, label, id and note visible text, not only spaces or tool-call debris.",
				)
					.slice(0, FLOWCHART_MAX_ISSUES)
					.map((entry) => ({
						...entry,
						stage: "flowchart",
						ref: {
							kind: "diagram",
							path:
								entry.ref?.path && entry.ref.path !== "input" ? `spec.${entry.ref.path}` : "spec",
						},
					}))
			: error.issues.map((entry) => ({
					code: entry.code,
					severity: "error",
					stage: "flowchart",
					...(entry.ref
						? {
								ref: {
									kind: entry.ref.kind,
									...(entry.ref.id ? { id: entry.ref.id } : {}),
									...(entry.ref.path ? { path: `spec.${entry.ref.path}` } : {}),
								},
							}
						: {}),
					message: entry.message,
					hint: entry.hint,
				})),
	resolve: Effect.fn("flowchart.resolveIcons")(function* (document: FlowchartDocument) {
		const normalized = normalizeFlowchartSpec(document);
		if (!normalized.ok) return yield* FlowchartValidationError.fromIssues(normalized.issues);
		const authoredSpec = normalized.spec;
		const source = yield* BuildIconSource;
		const catalog = yield* source.catalog(authoredSpec);
		// Cleaning can empty a string that passed the request boundary.
		yield* Effect.fromResult(decodeFlowchartDocument(authoredSpec));
		const logos = resolveFlowchartLogos(authoredSpec, catalog);
		const normalizedSpec: NormalizedFlowchartSpec = {
			...authoredSpec,
			nodes: Object.fromEntries(
				Object.entries(authoredSpec.nodes).map(([id, node]) => {
					const slug = logos.icons.get(id);
					if (typeof node === "string") return [id, slug ? { label: node, icon: slug } : node];
					if (slug) return [id, { ...node, icon: slug }];
					if (typeof node.icon !== "string") return [id, node];
					const { icon: _icon, ...rest } = node;
					return [id, Object.keys(rest).length === 1 ? rest.label : rest];
				}),
			),
		};
		const built = flowchartDiagramFromDocument(normalizedSpec, { nodeIcons: logos.icons });
		const groupLogos =
			built.ok && normalizedSpec.logos
				? fillGroupLogos(
						built.diagram.groups?.map((group) => ({
							id: group.id,
							label: group.label,
							...(group.parent ? { parent: group.parent } : {}),
						})),
						built.diagram.nodes.map((node) => ({
							...(node.group ? { group: node.group } : {}),
							...(node.icon ? { icon: node.icon } : {}),
						})),
						catalog,
						{ fillNamedLogos: true },
					)
				: { issues: [], logos: new Map<string, string>() };
		// Resolving group marks changes only their icon; reuse the validated roles and containment.
		const checked = built.ok
			? Result.succeed(
					groupLogos.logos.size === 0
						? built.diagram
						: {
								...built.diagram,
								groups: built.diagram.groups?.map((group) => {
									const slug = groupLogos.logos.get(group.id);
									return slug ? { ...group, icon: { slug } } : group;
								}),
							},
				)
			: Result.fail(FlowchartValidationError.fromIssues(built.issues));
		return {
			document: normalizedSpec,
			checked,
			storedDocument: { type: "flowchart", spec: authoredSpec },
			issues: [
				...normalized.notes.map((message): CodeModeIssue => ({
					code: "reference_resolved",
					hint: "Use the resolved declared id in future references.",
					severity: "info",
					stage: "flowchart",
					message,
				})),
				...logos.issues,
				...groupLogos.issues,
			],
			render: (scene) =>
				embedSceneIcons(scene, catalog, { exactIcons: normalizedSpec.logos === "exact" }),
		};
	}),
	assess: assessFlowchartQuality,
	qualityIssues,
	render: renderFlowchartDiagram,
	warnings: (diagram, request, scene): CodeModeIssue[] => [
		...longNodeDescriptions(scene).map((id): CodeModeIssue => ({
			code: "label_too_long",
			severity: "warning",
			stage: "render",
			ref: { kind: "node", id, path: "spec.nodes.description" },
			message: `Node "${id}" has a description longer than ${NODE_DESCRIPTION_MAX_LINES} lines; it draws in full under the label.`,
			hint: "Keep a description to a short subtitle, and name technologies in the label.",
		})),
		...(request === undefined
			? []
			: checkRequestCoverage(request, diagram).flatMap((entry): CodeModeIssue[] =>
					isFlowchartCoverageCode(entry.code)
						? [
								{
									code: entry.code,
									severity: "warning",
									stage: "coverage",
									ref: { kind: "diagram" },
									message: entry.message,
									hint: "Fix it with editFlowchart({ artifactId, edits }) before you answer.",
								},
							]
						: [],
				)),
	],
	renderHint: "Simplify the graph or retry with a smaller flowchart.",
});

export type BuildFlowchartRequest = typeof flowchartBuild.request.Type;
export type BuildFlowchartResult = typeof flowchartBuild.result.Type;
export type BuildFlowchartAccepted = typeof flowchartBuild.accepted.Type;
export type BuildFlowchartRejected = typeof flowchartBuild.rejected.Type;
export type BuildFlowchartToolInput = typeof flowchartBuild.toolInput.Type;
