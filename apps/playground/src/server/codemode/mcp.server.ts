import "@tanstack/react-start/server-only";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Array, Context, Effect, Schema } from "effect";
import { PlaygroundBindings, PlaygroundPlatformCallbacks } from "../runtime/context.server";
import {
	PlaygroundRequestCallbacks,
	type PlaygroundRequestRunner,
} from "../runtime/runtime.server";
import { PlaygroundCodeMode } from "./service.server";
import { prewarmPngRendererOnSessionStart, readMcpMessage } from "./mcp-session-prewarm.server";
import { createEffectMcpServer, makeEffectMcpTool } from "./effect-mcp-adapter.server";
import { SKETCHI_CODE_MODE_VERSION, formatCodeModeDocs } from "./mcp-docs.server";
import type { CodeModeMcpOptions } from "./execute.server";
import { SketchiToolkit, makeSketchiToolHandlers, dispatchSketchiTool } from "./toolkit.server";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
function finalResponseTextFromResult(value: Record<string, unknown>) {
	return (
		stringValue(value.finalResponseText) ??
		(isRecord(value.artifactDelivery)
			? stringValue(value.artifactDelivery.finalResponseText)
			: undefined)
	);
}

/** Calling models read every text block; JSON stays compact because indentation is paid in tokens. */
const toolResult = Effect.fn("sketchi.mcp.result")(function* (
	value: Record<string, unknown>,
	text?: readonly string[],
) {
	const blocks = text ?? [
		yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(Effect.orDie),
	];
	return {
		content: Array.map(blocks, (block) => ({ type: "text" as const, text: block })),
		structuredContent: value,
	};
});

const executeResult = Effect.fn("sketchi.mcp.executeResult")(function* (
	value: Record<string, unknown>,
) {
	const lead = stringValue(value.coverageNotice) ?? finalResponseTextFromResult(value);
	const json = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(
		Effect.orDie,
	);
	return yield* toolResult(value, [...(lead ? [lead] : []), json]);
});

interface MinimalExecutionContext {
	passThroughOnException(): void;
	props: Record<string, unknown>;
	waitUntil(promise: Promise<unknown>): void;
}

type McpHttpHandler = (
	request: Request,
	env: unknown,
	ctx: MinimalExecutionContext,
) => Promise<Response>;

const docs = makeEffectMcpTool(SketchiToolkit.tools.docs, (result) =>
	toolResult(result, [formatCodeModeDocs(result)]),
);
const search = makeEffectMcpTool(SketchiToolkit.tools.search, toolResult);
const execute = makeEffectMcpTool(SketchiToolkit.tools.execute, executeResult);

export function createSketchiMcpServer(
	runToolEffect: PlaygroundRequestRunner,
	options: CodeModeMcpOptions = {},
): Server {
	const handlers = makeSketchiToolHandlers(runToolEffect, options);
	return createEffectMcpServer({
		name: "sketchi-code-mode",
		version: SKETCHI_CODE_MODE_VERSION,
		tools: [
			docs.bind(
				(input) =>
					// @effect-diagnostics-next-line strictEffectProvide:off -- SDK callback is the request-owned Toolkit layer entry point.
					dispatchSketchiTool(SketchiToolkit.tools.docs, input).pipe(Effect.provide(handlers)),
				runToolEffect,
			),
			search.bind(
				(input) =>
					// @effect-diagnostics-next-line strictEffectProvide:off -- SDK callback is the request-owned Toolkit layer entry point.
					dispatchSketchiTool(SketchiToolkit.tools.search, input).pipe(Effect.provide(handlers)),
				runToolEffect,
			),
			execute.bind(
				(input) =>
					// @effect-diagnostics-next-line strictEffectProvide:off -- SDK callback is the request-owned Toolkit layer entry point.
					dispatchSketchiTool(SketchiToolkit.tools.execute, input).pipe(Effect.provide(handlers)),
				runToolEffect,
			),
		],
	});
}

function createExecutionContext(
	platform: Context.Service.Shape<typeof PlaygroundPlatformCallbacks>,
): MinimalExecutionContext {
	return {
		passThroughOnException() {},
		props: {},
		waitUntil: platform.waitUntilPromise,
	};
}

export class McpTransportError extends Schema.TaggedError<
	McpTransportError,
	{ readonly brand: unique symbol }
>()("McpTransportError", {
	cause: Schema.Defect(),
	message: Schema.String,
}) {}

export const handleSketchiMcpRequest = Effect.fn("playground.http.mcp")(function* (
	request: Request,
	options: CodeModeMcpOptions = {},
) {
	const callbacks = yield* PlaygroundRequestCallbacks;
	const env = yield* PlaygroundBindings;
	const platform = yield* PlaygroundPlatformCallbacks;
	const message = yield* readMcpMessage(request);
	platform.waitUntil(prewarmPngRendererOnSessionStart(message, yield* PlaygroundCodeMode));
	const createLegacyMcpHandler = yield* Effect.tryPromise({
		try: () => import("agents/mcp").then((module) => module.createLegacyMcpHandler),
		catch: (cause) =>
			McpTransportError.make({
				cause,
				message: cause instanceof Error ? cause.message : "MCP transport failed.",
			}),
	});
	const handler: McpHttpHandler = createLegacyMcpHandler(
		createSketchiMcpServer(callbacks.runPromise, options),
		{ route: "/mcp" },
	);

	return yield* Effect.tryPromise({
		try: (signal) =>
			handler(
				new Request(request, {
					signal: AbortSignal.any([signal, request.signal]),
				}),
				env,
				createExecutionContext(platform),
			),
		catch: (cause) =>
			McpTransportError.make({
				cause,
				message: cause instanceof Error ? cause.message : "MCP transport failed.",
			}),
	});
});
