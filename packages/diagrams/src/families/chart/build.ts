import { PublishedBuildIssue } from "../../build/result";
import { Array } from "effect";
import { defineBuild } from "../../build/operation";
import {
	ChartDocument,
	ChartDiagram,
	ChartValidationError,
	ChartValidationIssueCodeSchema,
	normalizeChart,
	validateChartDiagram,
	counts,
} from "./document";
import { renderChartDiagram } from "./render";

export const chartBuild = defineBuild({
	publishedIssues: PublishedBuildIssue,
	name: "chart",
	document: ChartDocument,
	normalized: ChartDiagram,
	tool: ChartDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: ChartValidationError,
	issueCodes: ChartValidationIssueCodeSchema,
	invalidStatus: "invalid_chart",
	normalize: normalizeChart,
	check: validateChartDiagram,
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
	render: renderChartDiagram,
	renderHint: "Use fewer categories or series and retry buildChart.",
});
