import { Order as Ord, Array as Arr, Record as Rec, Effect, Schema } from "effect";
import { families, type FamilyOperation, type DiagramFamily } from "@sketchi/diagrams/family";
import { type OfferedLogo } from "@sketchi/diagrams/generate/logo-placement";
import "@tanstack/react-start/server-only";
import { buildResponse } from "@sketchi/diagrams/build/operation";
import * as Build from "@sketchi/diagrams/build/code-mode/runtime";
import {
	type PlaygroundCallbackEffect,
	type PlaygroundRequestRunner,
} from "../runtime/runtime.server";
import { toPlaygroundStandardSchema } from "../schema/effect-standard-schema.server";
import {
	makeStudioFlowchartToolExecutor,
	makeStudioSequenceToolExecutor,
} from "./studio-build-policy.server";
import {
	makeStudioBuildToolExecutor,
	studioBuildModelOutput,
	type StudioBuildTurn,
} from "./studio-build-tool.server";
export function makeStudioBuildToolCallback<Input, Result, E>(
	executor: {
		readonly execute: (input: Input) => PlaygroundCallbackEffect<Result, E>;
	},
	run: PlaygroundRequestRunner,
) {
	return (input: Input) => run(executor.execute(input));
}
function buildTool<
	S extends Schema.ConstraintDecoder<unknown>,
	O extends Schema.ConstraintDecoder<unknown>,
>(
	family: {
		readonly studioInput: S;
		readonly contracts: {
			readonly output: O;
		};
		readonly docs: {
			readonly toolDescription: string;
		};
	},
	executor: {
		readonly execute: (input: S["Type"]) => PlaygroundCallbackEffect<O["Type"]>;
	},
	run: PlaygroundRequestRunner,
) {
	return {
		description: family.docs.toolDescription,
		inputSchema: toPlaygroundStandardSchema(family.studioInput),
		outputSchema: toPlaygroundStandardSchema(family.contracts.output),
		toModelOutput: studioBuildModelOutput,
		execute: makeStudioBuildToolCallback(executor, run),
	};
}
export function makeStudioFamilyTool(
	family: DiagramFamily,
	options: {
		readonly turn: StudioBuildTurn;
		readonly logos: readonly OfferedLogo[];
		readonly request: string;
	},
	run: PlaygroundRequestRunner,
) {
	return Effect.gen(function* () {
		if (family.type === "flowchart") {
			const executor = yield* makeStudioFlowchartToolExecutor(
				(input) => buildResponse(family.build(Build)(input)),
				options,
			);
			return buildTool(family, executor, run);
		}
		if (family.type === "sequence") {
			const executor = yield* makeStudioSequenceToolExecutor(
				(input) => buildResponse(family.build(Build)(input)),
				options,
			);
			return buildTool(family, executor, run);
		}
		const operation: FamilyOperation<PlainFamilyResult> = family;
		const executor = yield* makeStudioFamilyExecutor(
			family,
			(input) => buildResponse(operation.build(Build)(input)),
			options,
		);
		return buildTool<typeof family.studioInput, typeof family.contracts.output>(
			family,
			executor,
			run,
		);
	});
}
export const makeStudioFamilyTools = Effect.fn("playground.chat.familyTools")(function* (
	options: {
		readonly turn: StudioBuildTurn;
		readonly logos: readonly OfferedLogo[];
		readonly request: string;
	},
	run: PlaygroundRequestRunner,
) {
	const entries = yield* Effect.forEach(
		Arr.sort(
			families,
			Ord.make((left: DiagramFamily, right: DiagramFamily) =>
				Ord.Number(left.docs.studioOrder, right.docs.studioOrder),
			),
		),
		(family) =>
			Effect.map(
				makeStudioFamilyTool(family, options, run),
				(tool) => [family.docs.toolName, tool] as const,
			),
	);
	return Rec.fromEntries(entries);
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
