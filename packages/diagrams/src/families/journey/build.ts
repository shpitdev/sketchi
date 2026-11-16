import { PublishedBuildIssue } from "../../build/result";
import { Array, Result } from "effect";
import { defineBuild } from "../../build/operation";
import {
	JourneyDocument,
	JourneyDiagram,
	JourneyValidationError,
	JourneyValidationIssueCodeSchema,
	normalizeJourney,
	resolveJourneyShorthand,
	validateJourneyDiagram,
	counts,
} from "./document";
import { renderJourneyDiagram } from "./render";

export const journeyBuild = defineBuild({
	publishedIssues: PublishedBuildIssue,
	name: "journey",
	document: JourneyDocument,
	normalized: JourneyDiagram,
	tool: JourneyDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: JourneyValidationError,
	issueCodes: JourneyValidationIssueCodeSchema,
	invalidStatus: "invalid_journey",
	prepare: (input: unknown) =>
		Result.succeed(
			typeof input === "object" && input !== null && "spec" in input
				? { ...input, spec: resolveJourneyShorthand(input.spec) }
				: input,
		),
	normalize: normalizeJourney,
	check: validateJourneyDiagram,
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
	render: renderJourneyDiagram,
	renderHint: "Shorten step labels or notes, or split the journey, and retry buildJourneyMap.",
});
