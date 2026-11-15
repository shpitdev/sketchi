import { Array, Result } from "effect";
import { defineBuild } from "../../build/operation.js";
import {
	VennDocument,
	counts,
	VennDiagram,
	VennValidationError,
	VennValidationIssueCodeSchema,
	normalizeVenn,
	validateVennDiagram,
	resolveVennShorthand,
} from "./document.js";
import { renderVennDiagram } from "./render.js";

export const vennBuild = defineBuild({
	name: "venn",
	document: VennDocument,
	normalized: VennDiagram,
	tool: VennDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: VennValidationError,
	issueCodes: VennValidationIssueCodeSchema,
	invalidStatus: "invalid_venn_diagram",
	prepare: (input: unknown) =>
		Result.succeed(
			typeof input === "object" && input !== null && "spec" in input
				? { ...input, spec: resolveVennShorthand(input.spec) }
				: input,
		),
	normalize: normalizeVenn,
	check: validateVennDiagram,
	issues: (error) =>
		Array.map(error.issues, (entry) => ({
			code: entry.code,
			severity: "error",
			stage: "input",
			ref: { kind: "request", path: `spec.${entry.path}` },
			message: entry.message,
			hint: entry.hint,
		})),
	counts,
	render: renderVennDiagram,
	renderHint: "Repair the sets and regions and retry.",
});
