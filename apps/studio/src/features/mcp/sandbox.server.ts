import "@tanstack/react-start/server-only";

import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { ICON_DRAW_BUDGET_MS } from "@sketchi/icon-draw";
import { Context, Effect, Layer, Schema } from "effect";
import { PlaygroundBindings } from "../../server/context.server";

export interface SandboxResult {
	readonly result: unknown;
	readonly error?: string;
	readonly logs?: string[];
}
export type SandboxFunctions = Readonly<Record<string, (...args: unknown[]) => Promise<unknown>>>;
export type SketchiWorkerLoader = ConstructorParameters<typeof DynamicWorkerExecutor>[0]["loader"];

export class CodeModeExecutionError extends Schema.TaggedError<
	CodeModeExecutionError,
	{ readonly brand: unique symbol }
>()("CodeModeExecutionError", {
	cause: Schema.Defect(),
	message: Schema.String,
	stage: Schema.Literals(["configuration", "execute"]),
}) {}

export class CodeModeSandbox extends Context.Service<
	CodeModeSandbox,
	{
		readonly execute: (
			code: string,
			functions: SandboxFunctions,
		) => Effect.Effect<SandboxResult, CodeModeExecutionError, PlaygroundBindings>;
	}
>()("studio/CodeModeSandbox") {}

/**
 * Interrupting the MCP call closes its host callback FiberSet. The native
 * executor owns the sandbox timeout and exposes no AbortSignal API; closing
 * callbacks does not establish when remote sandbox compute or billing stops.
 */
export const CodeModeSandboxLive = Layer.succeed(CodeModeSandbox, {
	execute: Effect.fn("studio.mcp.sandbox")(function* (code, functions) {
		const { LOADER: loader } = yield* PlaygroundBindings;
		if (!loader)
			return yield* new CodeModeExecutionError({
				cause: undefined,
				message: "Code Mode Worker Loader binding is not configured (env.LOADER).",
				stage: "configuration",
			});
		return yield* Effect.tryPromise({
			try: () =>
				new DynamicWorkerExecutor({
					loader,
					globalOutbound: null,
					timeout: Math.max(30_000, ICON_DRAW_BUDGET_MS + 10_000),
				}).execute(code, [{ name: "sketchi", fns: functions }]),
			catch: (cause) =>
				new CodeModeExecutionError({
					cause,
					message: cause instanceof Error ? cause.message : "Code Mode execution failed.",
					stage: "execute",
				}),
		});
	}),
});
