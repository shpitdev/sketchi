import { Array, Result } from "effect";
import { defineBuild } from "../../build/operation.js";
import { PublishedBuildIssue } from "../../build/result.js";
import {
	StateMachineDocument,
	StateMachineDiagram,
	StateMachineValidationError,
	StateMachineValidationIssueCodeSchema,
	normalizeStateMachine,
	validateStateMachineDiagram,
	getStateMachineDefaultWarnings,
	splitContinuingFinalStates,
	counts,
} from "./document.js";
import { renderStateMachineDiagram } from "./render.js";

/** State authoring policy; shared build owns decoding, delivery and the response envelope. */
export const stateMachineBuild = defineBuild({
	name: "state-machine",
	document: StateMachineDocument,
	normalized: StateMachineDiagram,
	tool: StateMachineDocument.mapFields(({ style: _style, ...fields }) => fields),
	error: StateMachineValidationError,
	issueCodes: StateMachineValidationIssueCodeSchema,
	publishedIssues: PublishedBuildIssue,
	invalidStatus: "invalid_state_machine",
	prepare: (input: unknown) =>
		Result.succeed(
			typeof input === "object" && input !== null && "spec" in input
				? { ...input, spec: splitContinuingFinalStates(input.spec) }
				: input,
		),
	normalize: normalizeStateMachine,
	check: validateStateMachineDiagram,
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
	warnings: (document, _request, _scene, authored) =>
		Array.map(getStateMachineDefaultWarnings(document, authored), ({ path, ...entry }) => ({
			...entry,
			stage: "input",
			ref: { kind: "request", path: `spec.${path}` },
		})),
	render: renderStateMachineDiagram,
	renderHint: "Shorten state labels or split the machine and retry buildStateMachine.",
});
