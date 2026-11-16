import { Effect } from "effect";

import { DiagramBuilder } from "../builder";
import { DiagramStore } from "../store/service";
import { Command, exclusiveInputSourceFlags, resolveInputSource } from "../terminal/effect-cli";
import { readDocumentInput } from "../terminal/input";
import { runReported } from "../terminal/output";
import { storedData, summaryText } from "./present";
import { rootCommand } from "./root";

export const createCommand = Command.make(
	"create",
	exclusiveInputSourceFlags(),
	({ fileInput, jsonInput }) =>
		Effect.gen(function* () {
			const { output } = yield* rootCommand;
			const source = yield* resolveInputSource({ fileInput, jsonInput });
			const builder = yield* DiagramBuilder;
			const store = yield* DiagramStore;
			const operation = Effect.gen(function* () {
				const document = yield* readDocumentInput(source);
				const built = yield* builder.build(document);
				return yield* store.create(built);
			});
			yield* runReported(
				"create",
				output,
				operation,
				(diagram) => summaryText("created", diagram),
				storedData,
			);
		}),
).pipe(
	Command.withDescription(
		"Create one local diagram from exactly one canonical document source. The document is validated and built before the record directory is committed atomically. --file - rejects an interactive TTY with exit 2.",
	),
	Command.withShortDescription("Create a local diagram from canonical JSON."),
	Command.withExamples([
		{
			command: "sketchi create --file diagram.json",
			description: "Create from a UTF-8 JSON file.",
		},
		{
			command: "printf '%s' '{...}' | sketchi create --file - --output json",
			description: "Create from noninteractive stdin with a JSON result.",
		},
	]),
);
