import "@tanstack/react-start/server-only";

import { mcpToolContent } from "@sketchi/cloudflare/mcp-content";
import { type McpWebHandler, serveStatelessMcp } from "@sketchi/cloudflare/mcp-http";
import { ArtifactStorage, BuildRuntimeEnvironment } from "@sketchi/diagrams/build";
import {
	makeWorkersTelemetryLayer,
	SpanContent,
	withTelemetryCorrelation,
	withTelemetryExport,
	type TelemetryExportTarget,
} from "@sketchi/observability";
import { Context, Effect, Exit, Layer, Predicate, Scheduler, Scope } from "effect";
import { SecureRandom } from "effect/crypto";
import { McpProtocol, McpSchema, McpServer } from "effect/ai";
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import type { StudioEnv } from "../../server/studio-env.server";
import {
	StudioBindings,
	StudioClockLive,
	StudioIdsLive,
	StudioRequestMetadata,
} from "../../server/context.server";
import { correlationIdHeader } from "../../server/correlation.server";
import { StudioBuildHostLive, StudioBuildRequestLive } from "../build/capabilities.server";
import { StudioCodeModeUsageLive } from "../build/usage-events.server";
import { SKETCHI_CODE_MODE_VERSION, formatCodeModeDocs } from "./mcp-docs.server";
import { CodeModeSandboxLive } from "./sandbox.server";
import { SketchiToolkit, SketchiToolHandlers } from "./toolkit.server";

class StudioMcpExport extends Context.Service<StudioMcpExport, TelemetryExportTarget>()(
	"studio/McpExport",
) {}
const buildCapabilities = McpServer.middleware<{
	provides: ArtifactStorage | BuildRuntimeEnvironment;
}>()(
	// @effect-diagnostics-next-line strictEffectProvide:off -- MCP request boundary assembles concrete build capabilities in this call scope.
	(effect) => Effect.provide(effect, StudioBuildRequestLive),
);
const content = mcpToolContent((name, result) => {
	const value = result.structuredContent;
	if (!Predicate.isObject(value)) return result;
	if (name === "docs") {
		const text = formatCodeModeDocs(value);
		return text === undefined
			? result
			: new McpSchema.CallToolResult({ ...result, content: [{ type: "text", text }] });
	}
	if (name !== "execute") return result;
	const delivery = Predicate.isObject(value.artifactDelivery) ? value.artifactDelivery : undefined;
	const lead = value.coverageNotice ?? value.finalResponseText ?? delivery?.finalResponseText;
	return typeof lead !== "string"
		? result
		: new McpSchema.CallToolResult({
				...result,
				content: [{ type: "text", text: lead }, ...result.content],
			});
});

export const StudioMcpRegistrations = McpServer.toolkit(SketchiToolkit).pipe(
	Layer.provide(SketchiToolHandlers),
	Layer.provide(buildCapabilities.layer),
	Layer.provide(content),
);

/** One request's native server; bindings, correlation and export come from that request. */
function makeStudioMcpHandler(origin: string | null, env: StudioEnv): McpWebHandler {
	// Closed when the handler is disposed, after the response body, so late spans are sent too.
	const scope = Scope.makeUnsafe();
	const app = McpServer.layerHttp({
		name: "sketchi-code-mode",
		version: SKETCHI_CODE_MODE_VERSION,
		path: "/mcp",
		protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
		allowedOrigins: origin === null ? [] : [origin],
		registrations: StudioMcpRegistrations,
	}).pipe(
		Layer.provide(HttpServer.layerServices),
		Layer.provideMerge(
			Layer.mergeAll(
				StudioBuildHostLive,
				StudioClockLive,
				StudioIdsLive,
				StudioCodeModeUsageLive,
				CodeModeSandboxLive,
			),
		),
		Layer.provideMerge(makeWorkersTelemetryLayer({ resource: { serviceName: "sketchi-studio" } })),
		Layer.provideMerge(Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true)),
		Layer.provideMerge(Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))),
	);
	const runtime = HttpRouter.toWebHandler(app, {
		disableLogger: true,
		middleware: (effect) =>
			Effect.gen(function* () {
				const target = yield* StudioMcpExport;
				const metadata = yield* StudioRequestMetadata;
				const request = yield* HttpServerRequest.HttpServerRequest;
				return yield* effect.pipe(
					Effect.tap((response) =>
						Effect.annotateCurrentSpan({
							"http.response.status_code": response.status,
							...(response.body._tag === "Uint8Array"
								? { [SpanContent.httpResponseBody]: new TextDecoder().decode(response.body.body) }
								: {}),
						}),
					),
					withTelemetryExport(target),
					Effect.withSpan("studio.mcp", { attributes: { "http.request.method": request.method } }),
					(program) =>
						withTelemetryCorrelation(program, {
							attemptId: metadata.attemptId,
							runId: metadata.runId,
							traceId: metadata.traceId,
						}),
				);
			}),
	});
	return {
		dispose: () =>
			Effect.runPromise(
				Effect.promise(runtime.dispose).pipe(Effect.ensuring(Scope.close(scope, Exit.void))),
			),
		fetch(request, { replay }) {
			const url = new URL(request.url);
			return runtime.handler(
				request,
				Context.make(StudioBindings, env).pipe(
					Context.add(StudioRequestMetadata, {
						request,
						method: request.method,
						origin: url.origin,
						path: `${url.pathname}${url.search}`,
						attemptId:
							correlationIdHeader(request, "x-sketchi-attempt-id") ?? SecureRandom.uuidV4Unsafe(),
						runId: correlationIdHeader(request, "x-sketchi-run-id") ?? SecureRandom.uuidV4Unsafe(),
						traceId:
							correlationIdHeader(request, "x-sketchi-trace-id") ?? SecureRandom.uuidV4Unsafe(),
					}),
					Context.add(StudioMcpExport, {
						pipeline: replay ? undefined : env.TELEMETRY_SPANS,
						scope,
					}),
				),
			);
		},
	};
}

export const handleSketchiMcpRequest = (
	request: Request,
	env: StudioEnv,
	waitUntil: (promise: Promise<unknown>) => void,
) =>
	Effect.runPromise(
		serveStatelessMcp(
			request,
			() => makeStudioMcpHandler(request.headers.get("origin"), env),
			waitUntil,
		),
		{ signal: request.signal },
	);
