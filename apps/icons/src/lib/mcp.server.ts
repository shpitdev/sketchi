import { mcpToolContent } from "@sketchi/cloudflare/mcp-content";
import { type McpSessionNamespace, routeMcpSession } from "@sketchi/cloudflare/mcp-session";
import {
	makeWorkersTelemetryLayer,
	withTelemetryCorrelation,
	withTelemetryExport,
	type TelemetryExportTarget,
} from "@sketchi/observability";
import { Context, Effect, Layer, Predicate, Scheduler } from "effect";
import { SecureRandom } from "effect/crypto";
import { McpProtocol, McpSchema, McpServer } from "effect/ai";
import { HttpMiddleware, HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import { IconSource } from "./api.server.js";
import { createIconSourceLoader } from "./catalog.server.js";
import { corsPreflight, withCors } from "./cors-policy.js";
import type { IconsHttpEnv } from "./http.server.js";
import { IconToolkit, IconToolHandlers } from "./toolkit.server.js";

/** Request-owned export target, never captured in registrations or session state. */
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

/** A Durable Object owns this server's scope. Construction performs no binding I/O. */
export function makeIconMcpHandler(origin: string | null) {
	const app = McpServer.layerHttp({
		name: "sketchi-icons",
		version: "1.0.0",
		path: "/mcp",
		protocols: [McpProtocol.v2025_11_25, McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
		allowedOrigins: origin === null ? [] : [origin],
		allowSessionTermination: true,
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
		dispose: runtime.dispose,
		fetch(request: Request, env: IconsHttpEnv, waitUntil: (promise: Promise<unknown>) => void) {
			return runtime.handler(
				request,
				Context.make(IconSource, {
					origin: new URL(request.url).origin,
					sourceLoader: createIconSourceLoader(env.ASSETS),
				}).pipe(Context.add(IconMcpExport, { pipeline: env.TELEMETRY_SPANS, waitUntil })),
			);
		},
	};
}

export interface IconsMcpEnv extends IconsHttpEnv {
	readonly ICONS_MCP_SESSION: McpSessionNamespace;
}

/** Cloudflare fetch callback; native McpServer owns the HTTP protocol inside the session. */
export const handleIconMcpRequest = (request: Request, env: IconsMcpEnv) =>
	request.method === "OPTIONS"
		? Promise.resolve(corsPreflight())
		: Effect.runPromise(
				routeMcpSession(request, env.ICONS_MCP_SESSION).pipe(Effect.map(withCors)),
				{ signal: request.signal },
			);
