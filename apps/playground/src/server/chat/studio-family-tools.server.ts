import { Order as Ord, Array as Arr, Effect, Schema, Context } from "effect";
import { Tool, Toolkit, Prompt } from "effect/ai";
import { families, type FamilyOperation, type DiagramFamily } from "@sketchi/diagrams/family";
import { type OfferedLogo } from "@sketchi/diagrams/generate/logo-placement";
import "@tanstack/react-start/server-only";
import { buildResponse } from "@sketchi/diagrams/build/operation";
import * as Build from "@sketchi/diagrams/build/code-mode/runtime";
import type { PlaygroundCallbackEffect } from "../runtime/runtime.server";
import {
	makeStudioFlowchartToolExecutor,
	makeStudioSequenceToolExecutor,
} from "./studio-build-policy.server";
import {
	makeStudioBuildToolExecutor,
	studioModelResult,
	type StudioBuildTurn,
} from "./studio-build-tool.server";
function buildTool<S extends Schema.Top & Schema.ConstraintDecoder<unknown>, O extends Schema.Top & Schema.ConstraintDecoder<unknown>>(
 family: { readonly studioInput: S; readonly contracts: {readonly output: O}; readonly docs: {readonly toolDescription: string; readonly toolName: string}},
 executor: {readonly execute: (input:S["Type"]) => PlaygroundCallbackEffect<O["Type"]>},
) {
 const tool = Tool.make(family.docs.toolName, {
   description:family.docs.toolDescription, parameters:family.studioInput, success:family.contracts.output,
   toModelOutput:(output) => [Prompt.makePart("text",{text:Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(studioModelResult(output))})],
 });
 const toolkit = Toolkit.make(tool);
 return Effect.gen(function* () {
   const context = yield* Effect.context<Effect.Services<ReturnType<typeof executor.execute>>>();
   const handlers = yield* toolkit.toHandlers({[tool.name]:(input:S["Type"]) => executor.execute(input).pipe(Effect.provide(context))});
   return {toolkit,handlers};
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
				(input) => buildResponse(family.build(Build)(input)),
				options,
			);
			return yield* buildTool(family, executor);
		}
		if (family.type === "sequence") {
			const executor = yield* makeStudioSequenceToolExecutor(
				(input) => buildResponse(family.build(Build)(input)),
				options,
			);
			return yield* buildTool(family, executor);
		}
		const operation: FamilyOperation<PlainFamilyResult> = family;
		const executor = yield* makeStudioFamilyExecutor(
			family,
			(input) => buildResponse(operation.build(Build)(input)),
			options,
		);
		return yield* buildTool<typeof family.studioInput, typeof family.contracts.output>(
			family,
			executor,
		);
	});
}
export const makeStudioFamilyTools = Effect.fn("playground.chat.familyTools")(function* (
	options: {
		readonly turn: StudioBuildTurn;
		readonly logos: readonly OfferedLogo[];
		readonly request: string;
	},
) {
 const entries = yield* Effect.forEach(
   Arr.sort(families, Ord.make((left:DiagramFamily,right:DiagramFamily) => Ord.Number(left.docs.studioOrder,right.docs.studioOrder))),
   (family) => makeStudioFamilyTool(family,options),
 );
 return yield* Toolkit.merge(...Arr.map(entries,(entry) => entry.toolkit)).pipe(Effect.provide(Context.mergeAll(...Arr.map(entries,(entry) => entry.handlers))));
});

type PlainFamily = Exclude<
	DiagramFamily,
	{
		readonly type: "flowchart" | "sequence";
	}
>;
type PlainFamilyResult = PlainFamily["contracts"]["output"]["Type"];
export function makeStudioFamilyExecutor<F extends PlainFamily, E, R>(
	family: F,
	build: (input: unknown) => Effect.Effect<PlainFamilyResult, E, R>,
	options: {
		readonly turn?: StudioBuildTurn;
	} = {},
) {
	return makeStudioBuildToolExecutor<F["studioInput"]["Type"], PlainFamilyResult, E, R>({
		build,
		operation: family.operation,
		...options,
		rejected: (issue) => ({ ok: false, status: "quality_failed", issues: [issue] }),
	});
}
