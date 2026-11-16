import { PublishedBuildIssue } from "../../build/result";
import { Array } from "effect";
import { defineBuild } from "../../build/operation";
import {
	GanttDocument,
	GanttDiagram,
	GanttValidationError,
	GanttValidationIssueCodeSchema,
	normalizeGantt,
	validateGanttDiagram,
	counts,
	ganttScheduleConflicts,
} from "./document";
import { renderGanttDiagram } from "./render";

export const ganttBuild = defineBuild({
	publishedIssues: PublishedBuildIssue,
	name: "gantt",
	document: GanttDocument,
	normalized: GanttDiagram,
	tool: GanttDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: GanttValidationError,
	issueCodes: GanttValidationIssueCodeSchema,
	invalidStatus: "invalid_gantt",
	normalize: normalizeGantt,
	check: validateGanttDiagram,
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
	warnings: (document) =>
		Array.map(ganttScheduleConflicts(document), (conflict) => ({
			code: "gantt_schedule_conflict",
			severity: "warning",
			stage: "input",
			ref: { kind: "request", path: `spec.${conflict.path}` },
			message: `Task "${conflict.task}" starts before "${conflict.dependsOn}" finishes on ${conflict.finishes}.`,
			hint: `Keep dates the prompt states; otherwise start "${conflict.task}" after ${conflict.finishes}.`,
		})),
	render: renderGanttDiagram,
	renderHint: "Use fewer tasks or dependencies and retry buildGantt.",
});
