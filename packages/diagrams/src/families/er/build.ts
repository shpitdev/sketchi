import { Array, Result } from "effect";
import { defineBuild } from "../../build/operation";
import { PublishedBuildIssue } from "../../build/result";
import {
	ErDocument,
	ErDiagram,
	ErValidationError,
	ErValidationIssueCodeSchema,
	normalizeEr,
	validateErDiagram,
	resolveErShorthand,
	counts,
} from "./document";
import { renderErDiagram } from "./render";

/** ER authoring policy; shared build owns decoding, delivery and the response envelope. */
export const erBuild = defineBuild({
	name: "er",
	document: ErDocument,
	normalized: ErDiagram,
	tool: ErDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: ErValidationError,
	issueCodes: ErValidationIssueCodeSchema,
	publishedIssues: PublishedBuildIssue,
	invalidStatus: "invalid_er_diagram",
	prepare: (input: unknown) =>
		Result.succeed(
			typeof input === "object" && input !== null && "spec" in input
				? { ...input, spec: resolveErShorthand(input.spec) }
				: input,
		),
	normalize: normalizeEr,
	check: validateErDiagram,
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
	render: renderErDiagram,
	renderHint: "Shorten entity or field names, or split the schema, and retry buildErDiagram.",
});
