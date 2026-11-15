import { PublishedBuildIssue } from "../../build/result.js";
import { Array, Result } from "effect";
import { defineBuild } from "../../build/operation.js";
import {
	SankeyDocument,
	SankeyDiagram,
	SankeyValidationError,
	SankeyValidationIssueCodeSchema,
	normalizeSankey,
	resolveSankeyShorthand,
	validateSankeyDiagram,
	counts,
} from "./document.js";
import { renderSankeyDiagram } from "./render.js";
import { sankeyLayoutIssues } from "./readout.js";

export const sankeyBuild = defineBuild({
	publishedIssues: PublishedBuildIssue,
	name: "sankey",
	document: SankeyDocument,
	normalized: SankeyDiagram,
	tool: SankeyDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: SankeyValidationError,
	issueCodes: SankeyValidationIssueCodeSchema,
	invalidStatus: "invalid_sankey",
	prepare: (input: unknown) =>
		Result.succeed(
			typeof input === "object" && input !== null && "spec" in input
				? { ...input, spec: resolveSankeyShorthand(input.spec) }
				: input,
		),
	normalize: normalizeSankey,
	check: validateSankeyDiagram,
	counts,
	issues: (error) =>
		Array.map(error.issues, (entry) => ({
			code: entry.code,
			severity: "error",
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: entry.hint,
		})),
	render: renderSankeyDiagram,
	assessScene: (document, scene, quality) => {
		const issues = sankeyLayoutIssues(scene);
		if (issues.length === 0) return quality;
		return {
			...quality,
			accepted: false,
			score: 0,
			checks: [
				{
					code: "sankey_layout",
					passed: false,
					severity: "error",
					message: `${issues.length} labels, values or leaders would overlap another label or cover another flow, so the diagram would not read.`,
					refs: [{ kind: "diagram", id: document.id }],
				},
			],
		};
	},
	qualityIssue: {
		code: "quality_below_threshold",
		hint: "Shorten node and link labels or leave link labels out, or split the flows into smaller diagrams, then call buildSankey again.",
	},
	renderHint: "Shorten labels, or split the flows into smaller diagrams, and retry buildSankey.",
});
