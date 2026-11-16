import { PublishedBuildIssue } from "../../build/result";
import { Array } from "effect";
import { defineBuild } from "../../build/operation";
import {
	OrgChartDocument,
	OrgChartDiagram,
	OrgChartValidationError,
	OrgChartValidationIssueCodeSchema,
	normalizeOrgChart,
	prepareOrgChart,
	validateOrgChartDiagram,
	counts,
} from "./document";
import { renderOrgChartDiagram } from "./render";

export const orgChartBuild = defineBuild({
	publishedIssues: PublishedBuildIssue,
	name: "org-chart",
	document: OrgChartDocument,
	normalized: OrgChartDiagram,
	tool: OrgChartDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: OrgChartValidationError,
	issueCodes: OrgChartValidationIssueCodeSchema,
	invalidStatus: "invalid_org_chart",
	prepare: prepareOrgChart,
	normalize: normalizeOrgChart,
	check: validateOrgChartDiagram,
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
	render: renderOrgChartDiagram,
	renderHint: "Shorten names or titles, or split the chart by division, and retry buildOrgChart.",
});
