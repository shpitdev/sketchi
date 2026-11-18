import type { BuildIssue } from "@sketchi/diagrams/build/contract";
import { applyFlowchartEdits } from "@sketchi/diagrams/families/flowchart/edits";
import { Effect } from "effect";

import { DiagramBuilder } from "../builder";
import { resolveDiagramId } from "../diagram-catalog";
import { CliValidationError } from "../errors";
import { DiagramStore } from "../store/service";
import { Command, exclusiveInputSourceFlags, resolveInputSource } from "../terminal/effect-cli";
import { readEditInput } from "../terminal/input";
import { runReported } from "../terminal/output";
import { storedData, summaryText } from "./present";
import { diagramIdArgument, rootCommand } from "./root";

export const editCommand = Command.make(
	"edit",
	{
		diagramId: diagramIdArgument,
		...exclusiveInputSourceFlags(),
	},
	({ diagramId, fileInput, jsonInput }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const source = yield* resolveInputSource({ fileInput, jsonInput });
			const builder = yield* DiagramBuilder;
			const store = yield* DiagramStore;
			const operation = Effect.gen(function* () {
				const id = yield* resolveDiagramId(diagramId);
				const input = yield* readEditInput(source);
				if (input._tag === "Edits") {
					// Edits change the stored flowchart document, offline, with the function the
					// hosted editFlowchart uses; the result is the record's next revision.
					const stored = yield* store.show(id);
					if (stored.document.type !== "flowchart") {
						return yield* CliValidationError.make({
							message: `Diagram "${id}" is a ${stored.document.type}; edits change flowcharts.`,
							hint: "Pass the whole revised document instead of edits.",
							details: ["edits"],
						});
					}
					const edited = applyFlowchartEdits(stored.document.spec, input.edits);
					if (!edited.ok) {
						return yield* CliValidationError.make({
							message: `The edits do not apply to "${id}"; nothing changed.`,
							hint: edited.issues[0]?.hint ?? "Name ids the flowchart declares.",
							details: edited.issues.map((issue) => `${issue.path}: ${issue.message}`),
						});
					}
					const built = yield* builder.build({ type: "flowchart", spec: edited.document });
					const saved = yield* store.edit(id, built, stored.manifest.revision);
					return edited.notes.length === 0
						? saved
						: {
								...saved,
								warnings: [
									...(saved.warnings ?? []),
									...edited.notes.map((message): BuildIssue => ({
										code: "reference_resolved",
										severity: "info",
										stage: "input",
										message,
										hint: "Use the resolved id in later edits.",
									})),
								],
							};
				}
				const built = yield* builder.build(input.document);
				if (built.id !== id) {
					return yield* CliValidationError.make({
						message: `Edited document id "${built.id}" does not match "${id}".`,
						hint: "Keep spec.id equal to the diagram id being edited.",
						details: ["spec.id"],
					});
				}
				return yield* store.edit(id, built);
			});
			yield* runReported(
				"edit",
				output,
				operation,
				(diagram) => summaryText("edited", diagram),
				storedData,
			);
		}),
).pipe(
	Command.withDescription(
		'Change the canonical document for DIAGRAM_ID, offline. For a flowchart, pass {"edits":[...]} to change it by id or label: insert puts a step into an edge, set merges fields and removes with null, connect adds or relabels edges, disconnect removes them; sketchi show ID --document prints the ids. Any diagram also takes a complete replacement document whose spec.id matches DIAGRAM_ID. Sketchi validates and builds first, preserves the prior full authority state under revisions/, and atomically swaps the record. Patched and detached records refuse edit because their canonical document is no longer authoritative.',
	),
	Command.withShortDescription("Edit a flowchart by id, or replace a document."),
	Command.withExamples([
		{
			command:
				'sketchi edit checkout --json \'{"edits":[{"op":"insert","node":{"fraud":"Check for fraud"},"between":["review","pay"]},{"op":"set","nodes":{"pay":{"color":"green"}}}]}\'',
			description: "Insert a step and color another in a stored flowchart.",
		},
		{
			command: "sketchi edit release-flow --file revised.json",
			description: "Replace a document and retain the prior revision.",
		},
	]),
);
