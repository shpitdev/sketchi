import { PublishedBuildIssue } from "../../build/result";
import { Array } from "effect";
import { defineBuild } from "../../build/operation";
import {
	TimelineDocument,
	TimelineDiagram,
	TimelineValidationError,
	TimelineValidationIssueCodeSchema,
	normalizeTimeline,
	validateTimelineDiagram,
	counts,
} from "./document";
import { renderTimelineDiagram } from "./render";

export const timelineBuild = defineBuild({
	publishedIssues: PublishedBuildIssue,
	name: "timeline",
	document: TimelineDocument,
	normalized: TimelineDiagram,
	tool: TimelineDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: TimelineValidationError,
	issueCodes: TimelineValidationIssueCodeSchema,
	invalidStatus: "invalid_timeline",
	normalize: normalizeTimeline,
	check: validateTimelineDiagram,
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
	render: renderTimelineDiagram,
	renderHint: "Split the chronology into smaller timelines and retry buildTimeline.",
});
