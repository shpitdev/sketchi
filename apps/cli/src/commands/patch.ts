import { Effect } from "effect";

import { resolveDiagramId } from "../diagram-catalog.js";
import { CliValidationError } from "../errors.js";
import { DiagramPatcher } from "../patch.js";
import { DiagramStore } from "../store/service.js";
import { Command, exclusiveInputSourceFlags, resolveInputSource } from "../terminal/effect-cli.js";
import { readPatchInput } from "../terminal/input.js";
import { runReported } from "../terminal/output.js";
import { storedData, summaryText } from "./present.js";
import { diagramIdArgument, rootCommand } from "./root.js";

export const patchCommand = Command.make(
	"patch",
	{
		diagramId: diagramIdArgument,
		...exclusiveInputSourceFlags("patch request"),
	},
	({ diagramId, fileInput, jsonInput }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const source = yield* resolveInputSource({ fileInput, jsonInput });
			const patcher = yield* DiagramPatcher;
			const store = yield* DiagramStore;
			const operation = Effect.gen(function* () {
				const id = yield* resolveDiagramId(diagramId);
				const input = yield* readPatchInput(source);
				// A flowchart changes through its document; its drawing is never patched.
				const stored = yield* store.show(id);
				if (stored.document.type === "flowchart") {
					return yield* CliValidationError.make({
						message: `Diagram "${id}" is a flowchart, which is not patched.`,
						hint: `Change it with sketchi edit ${id} --json '{"edits":[...]}': colors, shapes, labels and steps are all edits.`,
						details: ["document.type"],
					});
				}
				const current = yield* store.readPatchSource(id);
				const artifacts = yield* patcher.patch(
					current.scene,
					input,
					`cli-patch-${id}-${String(current.revision + 1)}`,
				);
				return yield* store.commitPatch(id, current.revision, artifacts);
			});
			yield* runReported(
				"patch",
				output,
				operation,
				(diagram) => summaryText("patched", diagram),
				storedData,
			);
		}),
).pipe(
	Command.withDescription(
		"Apply Sketchi semantic setStyle, setDefaultStyle, setShape, translate, replaceText, or rerouteEdges operations to the current stored scene of any diagram but a flowchart, which changes with sketchi edit. The CLI owns source and requestId; input contains operations plus optional options or intent. The prior full revision is recoverable, document.json remains unchanged provenance, stale stored PNG is removed, and the patched scene becomes authoritative. This command is strictly offline. Edit remains blocked until a canonical revision is restored.",
	),
	Command.withShortDescription("Apply semantic edits to a stored diagram."),
	Command.withExamples([
		{
			command:
				'sketchi patch launch-map --json \'{"operations":[{"op":"setStyle","selector":{"labels":["Product"]},"style":{"fillColor":"#dbeafe","strokeColor":"#2563eb","textColor":"#1e3a8a"}}]}\'',
			description: "Color a mindmap topic through its label.",
		},
		{
			command: "sketchi patch launch-map --file patch.json --output json",
			description: "Patch from a file, then export or restore the reported diagram revision.",
		},
	]),
);
