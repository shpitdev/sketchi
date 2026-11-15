import { Array, Result } from "effect";
import { defineBuild } from "../../build/operation.js";
import {
	VennDocument,
	VennDiagram,
	VennValidationError,
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
	assess: (document, threshold) => ({
		accepted: 10 >= threshold,
		score: 10,
		threshold,
		summary: { nodeCount: document.sets.length, edgeCount: 0 },
		checks: [],
	}),
	render: renderVennDiagram,
	renderHint: "Repair the sets and regions and retry.",
});
