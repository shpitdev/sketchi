import { PublishedBuildIssue } from "../../build/result";
import { Array } from "effect";
import { defineBuild } from "../../build/operation";
import {
	WireframeDocument,
	WireframeDiagram,
	WireframeValidationError,
	WireframeValidationIssueCodeSchema,
	prepareWireframe,
	normalizeWireframe,
	validateWireframeDiagram,
	counts,
} from "./document";
import { renderWireframeDiagram } from "./render";

export const wireframeBuild = defineBuild({
	publishedIssues: PublishedBuildIssue,
	name: "wireframe",
	document: WireframeDocument,
	normalized: WireframeDiagram,
	tool: WireframeDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: WireframeValidationError,
	issueCodes: WireframeValidationIssueCodeSchema,
	invalidStatus: "invalid_wireframe",
	prepare: prepareWireframe,
	normalize: normalizeWireframe,
	check: validateWireframeDiagram,
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
	render: (diagram) => renderWireframeDiagram(diagram).scene,
	renderHint:
		"Shorten long texts, or split the screens into separate wireframes, and retry buildWireframe.",
});
