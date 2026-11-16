import { mcpToolContent } from "@sketchi/cloudflare/mcp-content";
import { type McpWebHandler, serveStatelessMcp } from "@sketchi/cloudflare/mcp-http";
import {
	makeWorkersTelemetryLayer,
	withTelemetryCorrelation,
	withTelemetryExport,
	type TelemetryExportTarget,
	type TelemetryPipeline,
} from "@sketchi/observability";
import { Context, Effect, Exit, Layer, Predicate, Scheduler, Scope } from "effect";
import { SecureRandom } from "effect/crypto";
import { McpProtocol, McpSchema, McpServer } from "effect/ai";
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import {
	createIconSourceLoader,
	type IconAssetsBinding,
	IconSource,
} from "../catalog/catalog.server";
import { corsPreflight, withCors } from "../../shared/cors";
import { IconToolkit, IconToolHandlers } from "./toolkit.server";

/** Request-owned export target, never captured in registrations. */
class IconMcpExport extends Context.Service<IconMcpExport, TelemetryExportTarget>()(
	"icons/McpExport",
) {}

const content = mcpToolContent((name, result) => {
	const value = result.structuredContent;
	if (
		name !== "get_icon" ||
		!Predicate.isObject(value) ||
		typeof value.svg !== "string" ||
		typeof value.svgUrl !== "string"
	)
		return result;
	return new McpSchema.CallToolResult({
		...result,
		content: [
			{ type: "text", text: value.svg },
			{ type: "text", text: `Permanent SVG URL: ${value.svgUrl}` },
		],
	});
});

export const IconMcpRegistrations = McpServer.toolkit(IconToolkit).pipe(
	Layer.provide(IconToolHandlers),
	Layer.provide(content),
);

/** One request's native server; its icon source and export come from that request. */
function makeIconMcpHandler(request: Request, env: IconsMcpEnv): McpWebHandler {
	const origin = request.headers.get("origin");
	// Closed when the handler is disposed, after the response body, so late spans are sent too.
	const scope = Scope.makeUnsafe();
	const app = McpServer.layerHttp({
		name: "sketchi-icons",
		version: "1.0.0",
		path: "/mcp",
		protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
		allowedOrigins: origin === null ? [] : [origin],
		registrations: IconMcpRegistrations,
	}).pipe(
		Layer.provide(HttpServer.layerServices),
		Layer.provideMerge(makeWorkersTelemetryLayer({ resource: { serviceName: "sketchi-icons" } })),
		Layer.provideMerge(Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true)),
		Layer.provideMerge(Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))),
	);
	const runtime = HttpRouter.toWebHandler(app, {
		disableLogger: true,
		middleware: (effect) =>
			Effect.gen(function* () {
				const target = yield* IconMcpExport;
				const request = yield* HttpServerRequest.HttpServerRequest;
				return yield* effect.pipe(
					withTelemetryExport(target),
					Effect.withSpan("icons.mcp", { attributes: { "http.request.method": request.method } }),
					(program) =>
						withTelemetryCorrelation(program, { requestId: SecureRandom.uuidV4Unsafe() }),
				);
			}),
	});
	return {
		dispose: () =>
			Effect.runPromise(
				Effect.promise(runtime.dispose).pipe(Effect.ensuring(Scope.close(scope, Exit.void))),
			),
		fetch(request, { replay }) {
			return runtime.handler(
				request,
				Context.make(IconSource, {
					origin: new URL(request.url).origin,
					sourceLoader: createIconSourceLoader(env.ASSETS),
				}).pipe(
					Context.add(IconMcpExport, {
						pipeline: replay ? undefined : env.TELEMETRY_SPANS,
						scope,
					}),
				),
			);
		},
	};
}

export interface IconsMcpEnv {
	readonly ASSETS: IconAssetsBinding;
	readonly TELEMETRY_SPANS?: TelemetryPipeline;
}

/** Cloudflare fetch callback; native McpServer owns the HTTP protocol for each request. */
export const handleIconMcpRequest = (
	request: Request,
	env: IconsMcpEnv,
	waitUntil: (promise: Promise<unknown>) => void,
) =>
	request.method === "OPTIONS"
		? Promise.resolve(corsPreflight())
		: Effect.runPromise(
				serveStatelessMcp(request, () => makeIconMcpHandler(request, env), waitUntil).pipe(
					Effect.map(withCors),
				),
				{ signal: request.signal },
			);
