import { Effect, Option, Schema, Stream } from "effect";
import { AiError, Tool, Toolkit } from "effect/ai";
import {
	PlaygroundBindings,
	PlaygroundClock,
	PlaygroundIds,
	PlaygroundRequestMetadata,
} from "../runtime/context.server";
import type { PlaygroundRequestRunner } from "../runtime/runtime.server";
import { PlaygroundCodeMode } from "./service.server";
import { PlaygroundCodeModeUsage } from "./usage-events.server";
import {
	CodeModeDocsRequestSchema,
	CodeModeDocsResultSchema,
	CodeModeSearchRequestSchema,
	CodeModeSearchResultSchema,
	getCodeModeDocs,
	searchCodeModeDocs,
	SKETCHI_EXECUTE_DESCRIPTION,
} from "./mcp-docs.server";
import {
	ExecuteRequestSchema,
	ExecuteResultSchema,
	executeSketchiCodeMode,
	type CodeModeMcpOptions,
} from "./execute.server";

const Docs = Tool.make("docs", {
	description:
		"Read the request type, rules and a runnable example for a sketchi operation, or the overview, issues, patchOperations and examples topics.",
	parameters: CodeModeDocsRequestSchema,
	success: CodeModeDocsResultSchema,
})
	.annotate(Tool.Title, "Sketchi Code Mode docs")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true);

const Search = Tool.make("search", {
	description:
		"Search Sketchi Code Mode operations, schemas, examples, non-goals, and repair hints.",
	parameters: CodeModeSearchRequestSchema,
	success: CodeModeSearchResultSchema,
})
	.annotate(Tool.Title, "Search Sketchi Code Mode docs")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true);

const Execute = Tool.make("execute", {
	description: SKETCHI_EXECUTE_DESCRIPTION,
	parameters: ExecuteRequestSchema,
	success: ExecuteResultSchema,
	dependencies: [
		PlaygroundBindings,
		PlaygroundClock,
		PlaygroundIds,
		PlaygroundRequestMetadata,
		PlaygroundCodeMode,
		PlaygroundCodeModeUsage,
	],
})
	.annotate(Tool.Title, "Execute Sketchi Code Mode")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, false)
	.annotate(Tool.OpenWorld, false);

export const SketchiToolkit = Toolkit.make(Docs, Search, Execute);

export const makeSketchiToolHandlers = (
	runToolEffect: PlaygroundRequestRunner,
	options: CodeModeMcpOptions = {},
) =>
	SketchiToolkit.toLayer({
		docs: Effect.fn("sketchi.tools.docs")((input) => Effect.sync(() => getCodeModeDocs(input))),
		search: Effect.fn("sketchi.tools.search")((input) =>
			Effect.sync(() => searchCodeModeDocs(input)),
		),
		execute: (input) => executeSketchiCodeMode(input, runToolEffect, options),
	});

/** Consume Toolkit's stream in the call scope, including its handler finalizer. */
export const dispatchSketchiTool = Effect.fn("sketchi.tools.dispatch")(function* <
	Name extends keyof typeof SketchiToolkit.tools,
	Success extends Schema.ConstraintDecoder<unknown>,
>(tool: { readonly name: Name; readonly successSchema: Success }, input: Schema.Json) {
	const handlers = yield* SketchiToolkit;
	const stream = yield* handlers.handle(tool.name, input, undefined, { errors: "all" });
	const final = yield* stream.pipe(
		Stream.filter((result) => !result.preliminary),
		Stream.runLast,
	);
	if (Option.isNone(final)) {
		return yield* AiError.make({
			module: "SketchiToolkit",
			method: "dispatch",
			reason: new AiError.ToolResultEncodingError({
				toolName: tool.name,
				toolResult: undefined,
				description: "No final result",
			}),
		});
	}
	// HandlerResult includes ExecutionFailure even in error mode and isFailure is not
	// a discriminant. Project through the same success schema without a type assertion.
	return yield* Schema.decodeUnknownEffect(Schema.toType(tool.successSchema))(
		final.value.result,
	).pipe(
		Effect.mapError((error) =>
			AiError.make({
				module: "SketchiToolkit",
				method: "dispatch",
				reason: new AiError.ToolResultEncodingError({
					toolName: tool.name,
					toolResult: final.value.result,
					description: error.message,
				}),
			}),
		),
	);
});
