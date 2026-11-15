import { PublishedBuildIssue } from "../../build/result.js";
import { Array } from "effect";
import { defineBuild } from "../../build/operation.js";
import {
	QuadrantDocument,
	QuadrantDiagram,
	QuadrantValidationError,
	QuadrantValidationIssueCodeSchema,
	normalizeQuadrant,
	validateQuadrantDiagram,
	counts,
} from "./document.js";
import { renderQuadrantDiagram } from "./render.js";

export const quadrantBuild = defineBuild({
	publishedIssues: PublishedBuildIssue,
	name: "quadrant",
	document: QuadrantDocument,
	normalized: QuadrantDiagram,
	tool: QuadrantDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: QuadrantValidationError,
	issueCodes: QuadrantValidationIssueCodeSchema,
	invalidStatus: "invalid_quadrant_chart",
	normalize: normalizeQuadrant,
	check: validateQuadrantDiagram,
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
	render: renderQuadrantDiagram,
	renderHint: "Use fewer points or shorter labels and retry buildQuadrantChart.",
});
