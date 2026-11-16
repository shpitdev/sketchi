import "@tanstack/react-start/server-only";

import { ArtifactStorage, BuildRuntimeEnvironment } from "@sketchi/diagrams/build";
import { Effect } from "effect";
import { Tool, Toolkit } from "effect/ai";
import {
	PlaygroundBindings,
	PlaygroundClock,
	PlaygroundIds,
	PlaygroundRequestMetadata,
} from "../../server/context.server";
import { PlaygroundCodeModeUsage } from "../build/usage-events.server";
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
} from "./execute.server";
import { CodeModeSandbox } from "./sandbox.server";

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
		ArtifactStorage,
		BuildRuntimeEnvironment,
		PlaygroundCodeModeUsage,
		CodeModeSandbox,
	],
})
	.annotate(Tool.Title, "Execute Sketchi Code Mode")
	.annotate(Tool.Readonly, false)
	.annotate(Tool.Destructive, false)
	.annotate(Tool.Idempotent, false)
	.annotate(Tool.OpenWorld, false);

export const SketchiToolkit = Toolkit.make(Docs, Search, Execute);
export const SketchiToolHandlers = SketchiToolkit.toLayer({
	docs: Effect.fn("sketchi.tools.docs")((input) => Effect.sync(() => getCodeModeDocs(input))),
	search: Effect.fn("sketchi.tools.search")((input) =>
		Effect.sync(() => searchCodeModeDocs(input)),
	),
	execute: executeSketchiCodeMode,
});
