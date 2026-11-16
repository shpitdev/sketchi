import { inputIssues, formatContractSchemaError } from "./input";
import { CodeModeIssue, type CodeModeIssueCode, type CodeModeIssueRef } from "./result";

import { type Cause, Schema } from "effect";

import { storageIssue, type CodeModeArtifactStorageError } from "./artifacts";

export function issue(input: {
	code: CodeModeIssueCode;
	severity?: CodeModeIssue["severity"];
	stage: CodeModeIssue["stage"];
	ref?: CodeModeIssueRef;
	message: string;
	hint: string;
}): CodeModeIssue {
	return {
		code: input.code,
		severity: input.severity ?? "error",
		stage: input.stage,
		...(input.ref ? { ref: input.ref } : {}),
		message: input.message,
		hint: input.hint,
	};
}

/** Request decoding issues; an operation may supply its own hints and codes by path. */
export function codeModeInputIssues(
	error: Schema.SchemaError,
	hintFor?: (path: string) => string,
	codeFor?: (path: string) => CodeModeIssueCode | undefined,
): CodeModeIssue[] {
	return inputIssues(formatContractSchemaError(error), hintFor, codeFor);
}

export function responseRequestId(requestId: string | undefined) {
	return requestId ? { requestId } : {};
}

export function storageFailureIssue(
	error: CodeModeArtifactStorageError,
	code: "storage_read_failed" | "storage_write_failed",
) {
	return storageIssue(error.message, code);
}

export const FailureContextSchema = Schema.Struct({
	issues: Schema.Array(Schema.toEncoded(CodeModeIssue)).pipe(Schema.mutable),
});

/** A workflow's typed failure: the rejected status and the response context it carries. */
export interface CodeModeWorkflowFailure<Status extends string, C> extends Cause.YieldableError {
	readonly _tag: string;
	readonly status: Status;
	readonly context: C;
}

export function workflowFailure<
	const Tag extends string,
	const Statuses extends readonly string[],
	C extends { readonly issues: CodeModeIssue[] },
>(
	tag: Tag,
	status: Schema.Literals<Statuses>,
	context: Schema.Codec<C, unknown>,
): {
	readonly new: (input: {
		readonly status: Statuses[number];
		readonly context: C;
	}) => CodeModeWorkflowFailure<Statuses[number], C>;
} {
	class WorkflowFailure extends Schema.TaggedError<
		WorkflowFailure,
		{ readonly brand: unique symbol }
	>()(tag, {
		message: Schema.String,
		status,
		context,
	}) {
		static new(input: { readonly status: Statuses[number]; readonly context: C }): WorkflowFailure {
			// Failure context can contain the normalized input that failed validation.
			return WorkflowFailure.make(
				{
					...input,
					message: input.context.issues[0]?.message ?? input.status,
				},
				{ disableChecks: true },
			);
		}
	}
	return WorkflowFailure;
}

export function failureResult<Status extends string, Context>(error: {
	readonly status: Status;
	readonly context: Context;
}) {
	return { ok: false as const, status: error.status, ...error.context };
}
