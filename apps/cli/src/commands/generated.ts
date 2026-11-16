import { Effect } from "effect";
import isCI from "is-ci";

import type { OutputFormat } from "../contracts.js";
import type { CliFailure } from "../errors.js";
import type { GeneratedArtifact, GenerateWorkflowResult } from "../generate-workflow.js";
import type { GenerateDiagramResult } from "../generation.js";
import {
	automaticCopySkipReason,
	Clipboard,
	clipboardData,
	type ClipboardOutcome,
} from "../terminal/clipboard.js";
import { runReportedArtifact } from "../terminal/output.js";
import {
	COPIED_ROW,
	displayHint,
	exportData,
	headline,
	row,
	storedData,
	warningLines,
} from "./present.js";

function generatedData(result: GenerateDiagramResult) {
	return {
		...storedData(result.diagram),
		generation: {
			model: result.model,
			provider: result.provider,
			...(result.attempts === undefined ? {} : { attempts: result.attempts }),
			...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
			...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }),
		},
		...(result.edits === undefined ? {} : { edits: result.edits }),
	};
}

interface GenerateCommandResult extends GenerateWorkflowResult {
	readonly clipboard: ClipboardOutcome;
	/** Agents reading piped text need the display hint; a person at a terminal does not. */
	readonly displayHint: boolean;
}

function generatedArtifactData(result: GenerateCommandResult) {
	return {
		...generatedData(result.generated),
		export: exportData(result.artifact),
		clipboard: clipboardData(result.clipboard),
	};
}

function savedRow(artifact: GeneratedArtifact): string {
	return artifact.destination === "-" ? row("Wrote", "stdout") : row("Saved", artifact.destination);
}

/** A skipped copy is silent: only a copy or a real failure is news. */
function clipboardRows(outcome: ClipboardOutcome): string[] {
	switch (outcome._tag) {
		case "Copied":
			return [COPIED_ROW];
		case "Failed":
			return [row("Clipboard", `not copied: ${outcome.reason}`)];
		case "Skipped":
			return [];
	}
}

function generatedArtifactText(result: GenerateCommandResult, revised = false): string {
	const diagram = result.generated.diagram;
	return [
		headline(diagram),
		savedRow(result.artifact),
		...clipboardRows(result.clipboard),
		row("Id", diagram.manifest.id),
		...(revised ? [row("Revision", String(diagram.manifest.revision))] : []),
		...warningLines(diagram),
		...(result.displayHint ? hintRows(result.artifact) : []),
	].join("\n");
}

function hintRows(artifact: GeneratedArtifact): string[] {
	const hint = displayHint(artifact);
	return hint ? [row("Hint", hint)] : [];
}

/** Whether generate's text should carry the agent display hint: only off a terminal. */
export function textNeedsDisplayHint(): boolean {
	return process.stdout.isTTY !== true;
}

/** Copy a freshly written PNG unless policy says not to; never fails the command. */
export const copyGeneratedArtifact = Effect.fn("sketchi.cli.generate.copy")(function* (
	artifact: GeneratedArtifact,
	copy: boolean,
) {
	const skipped = automaticCopySkipReason({
		copy,
		continuousIntegration: isCI,
		format: artifact.format,
		destination: artifact.destination,
	});
	if (skipped !== undefined) return { _tag: "Skipped", reason: skipped } satisfies ClipboardOutcome;
	const clipboard = yield* Clipboard;
	return yield* clipboard.copyPng(artifact.bytes);
});

export function reportGenerateOperation<E extends CliFailure, R>(
	output: OutputFormat,
	operation: Effect.Effect<GenerateCommandResult, E, R>,
	command: "generate" | "revise" = "generate",
) {
	return runReportedArtifact(
		command,
		output,
		operation,
		(result) => result.artifact,
		(result) => generatedArtifactText(result, command === "revise"),
		generatedArtifactData,
		(result) => (result.artifact.destination === "-" ? "stderr" : "stdout"),
	);
}
