import { Array, Result } from "effect";
import { defineBuild } from "../../build/operation";
import { PublishedBuildIssue } from "../../build/result";
import {
	ClassDocument,
	ClassDiagram,
	ClassValidationError,
	ClassValidationIssueCodeSchema,
	normalizeClass,
	validateClassDiagram,
	resolveClassShorthand,
	counts,
} from "./document";
import { renderClassDiagram } from "./render";

/** Class authoring policy; shared build owns decoding, delivery and the response envelope. */
export const classBuild = defineBuild({
	name: "class",
	document: ClassDocument,
	normalized: ClassDiagram,
	tool: ClassDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: ClassValidationError,
	issueCodes: ClassValidationIssueCodeSchema,
	publishedIssues: PublishedBuildIssue,
	invalidStatus: "invalid_class_diagram",
	prepare: (input: unknown) =>
		Result.succeed(
			typeof input === "object" && input !== null && "spec" in input
				? { ...input, spec: resolveClassShorthand(input.spec) }
				: input,
		),
	normalize: normalizeClass,
	check: validateClassDiagram,
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
	render: renderClassDiagram,
	renderHint: "Shorten class or member names, or split the model, and retry buildClassDiagram.",
});
