import { Order as Ord, Array as Arr, Effect, Schema, Context } from "effect";
import { Tool, Toolkit, Prompt } from "effect/ai";
import { families, type FamilyOperation, type DiagramFamily } from "@sketchi/diagrams/family";
import { type OfferedLogo } from "@sketchi/diagrams/generate/logo-placement";
import "@tanstack/react-start/server-only";
import { buildResponse, bindBuild } from "@sketchi/diagrams/build";
import { toCodeModeJsonSchema } from "@sketchi/diagrams/build/contract";
import type { StudioCallbackEffect } from "../../server/runtime.server";
import {
	makeStudioFlowchartToolExecutor,
	makeStudioSequenceToolExecutor,
} from "./studio-build-policy.server";
import {
	makeStudioBuildToolExecutor,
	studioModelResult,
	type StudioBuildTurn,
} from "./studio-build-tool.server";
function buildTool<Output>(
	family: {
		readonly studioInput: Schema.Top;
		readonly contracts: { readonly output: Schema.Codec<Output, unknown> };
		readonly docs: { readonly toolDescription: string; readonly toolName: string };
	},
	executor: { readonly execute: (input: unknown) => StudioCallbackEffect<Output> },
) {
	const tool = Tool.dynamic(family.docs.toolName, {
		description: family.docs.toolDescription,
		// The non-strict OpenAI adapter opens object properties by default. Use the
		// canonical tool schema for the wire; the executor owns preparation and validation.
		parameters: toCodeModeJsonSchema(family.studioInput),
		success: family.contracts.output,
		toModelOutput: (output) => [
			Prompt.makePart("text", {
				// @effect-diagnostics-next-line schemaSync:off -- Tool.toModelOutput is synchronous and the compact result is JSON-safe.
				text: Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(studioModelResult(output)),
			}),
		],
	});
	const toolkit = Toolkit.make(tool);
	return Effect.gen(function* () {
		const context = yield* Effect.context<Effect.Services<ReturnType<typeof executor.execute>>>();
		const handlers = yield* toolkit.toHandlers({
			[tool.name]: (input: unknown) => executor.execute(input).pipe(Effect.provide(context)),
		});
		return { toolkit, handlers };
	});
}
export function makeStudioFamilyTool(
	family: DiagramFamily,
	options: {
		readonly turn: StudioBuildTurn;
		readonly logos: readonly OfferedLogo[];
		readonly request: string;
	},
) {
	return Effect.gen(function* () {
		if (family.type === "flowchart") {
			const executor = yield* makeStudioFlowchartToolExecutor(
				(input) => buildResponse(family.build({ bindBuild })(input)),
				options,
			);
			return yield* buildTool(family, executor);
		}
		if (family.type === "sequence") {
			const executor = yield* makeStudioSequenceToolExecutor(
				(input) => buildResponse(family.build({ bindBuild })(input)),
				options,
			);
			return yield* buildTool(family, executor);
		}
		const operation: FamilyOperation<PlainFamilyResult> = family;
		const executor = yield* makeStudioFamilyExecutor(
			family,
			(input) => buildResponse(operation.build({ bindBuild })(input)),
			options,
		);
		return yield* buildTool(family, executor);
	});
}
export const makeStudioFamilyTools = Effect.fn("playground.chat.familyTools")(function* (options: {
	readonly turn: StudioBuildTurn;
	readonly logos: readonly OfferedLogo[];
	readonly request: string;
}) {
	const entries = yield* Effect.forEach(
		Arr.sort(
			families,
			Ord.make((left: DiagramFamily, right: DiagramFamily) =>
				Ord.Number(left.docs.studioOrder, right.docs.studioOrder),
			),
		),
		(family) => makeStudioFamilyTool(family, options),
	);
	return yield* Toolkit.merge(...Arr.map(entries, (entry) => entry.toolkit)).pipe(
		Effect.provide(Context.mergeAll(...Arr.map(entries, (entry) => entry.handlers))),
	);
});

type PlainFamily = Exclude<
	DiagramFamily,
	{
		readonly type: "flowchart" | "sequence";
	}
>;
type PlainFamilyResult = PlainFamily["contracts"]["output"]["Type"];
export function makeStudioFamilyExecutor<E, R>(
	family: PlainFamily,
	build: (input: unknown) => Effect.Effect<PlainFamilyResult, E, R>,
	options: {
		readonly turn?: StudioBuildTurn;
	} = {},
) {
	return makeStudioBuildToolExecutor<PlainFamily["request"]["Type"], PlainFamilyResult, E, R>({
		decode: family.decode,
		build,
		operation: family.operation,
		...options,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
	});
}
