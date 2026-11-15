import {
	CommunityHttpHandlers,
	CommunityHttpRequest,
	type CommunityEnv,
} from "@sketchi/community-icons";
import { IconCatalogHttpApi } from "@sketchi/icon-catalog/http-api";
import { CommunityHttpApi } from "@sketchi/community-icons/http-api";
import {
	makeWorkersTelemetryLayer,
	SpanContent,
	withTelemetryCorrelation,
	withTelemetryExport,
	type TelemetryExportTarget,
	type TelemetryPipeline,
	type TelemetrySpanSink,
} from "@sketchi/observability";
import {
	Array,
	Clock,
	Context,
	Effect,
	Exit,
	Layer,
	Option,
	Record,
	Scheduler,
	String,
} from "effect";
import { SecureRandom } from "effect/crypto";
import {
	Headers,
	HttpMiddleware,
	HttpRouter,
	HttpServer,
	HttpServerRequest,
	HttpServerError,
	HttpServerResponse,
	HttpTraceContext,
} from "effect/http";
import { HttpApi, HttpApiBuilder, OpenApi } from "effect/http-api";

import { IconSource } from "./api.server.js";
import { IconCatalogHttpHandlers } from "./catalog-http.server.js";
import { createIconSourceLoader, type IconAssetsBinding } from "./catalog.server.js";
import { ICONS_CORS_HEADERS } from "./cors-policy.js";

export interface IconsHttpEnv extends CommunityEnv {
	readonly ASSETS: IconAssetsBinding;
	readonly TELEMETRY_SPANS?: TelemetryPipeline;
}
class IconsHttpRequest extends Context.Service<
	IconsHttpRequest,
	{
		readonly target: TelemetryExportTarget;
		readonly requestId: string;
		readonly runId: string;
		readonly rayId?: string;
		readonly method: string;
		readonly url: string;
		readonly headers: Readonly<Record<string, string>>;
	}
>()("sketchi/IconsHttpRequest") {}

// Capture protocol/correlation metadata, never client addresses or arbitrary forwarded headers.
const telemetryRequestHeaders = [
	"accept",
	"accept-encoding",
	"accept-language",
	"content-type",
	"content-length",
	"user-agent",
	"origin",
	"cf-ray",
	"traceparent",
	"tracestate",
	"x-sketchi-client",
];

const responsePolicy = HttpRouter.middleware(
	(effect) =>
		Effect.gen(function* () {
			const request = yield* IconsHttpRequest;
			const response = yield* effect;
			return response.pipe(
				HttpServerResponse.setHeaders({
					...(response.status === 500 ? {} : ICONS_CORS_HEADERS),
					"x-sketchi-run-id": request.runId,
					"x-sketchi-request-id": request.requestId,
				}),
			);
		}),
	{ global: true },
);
const publicApi = HttpApi.make("IconsHttpApi")
	.addHttpApi(CommunityHttpApi)
	.addHttpApi(IconCatalogHttpApi);
const preflight = HttpServerResponse.empty({ status: 204, headers: ICONS_CORS_HEADERS });

/** Pure module-time composition. Bindings and the export target arrive on each request. */
export function makeIconsHttpHandler(options: { readonly sink?: TelemetrySpanSink } = {}) {
	const routes = Layer.merge(
		HttpApiBuilder.layer(CommunityHttpApi).pipe(Layer.provide(CommunityHttpHandlers)),
		HttpApiBuilder.layer(IconCatalogHttpApi).pipe(Layer.provide(IconCatalogHttpHandlers)),
	);
	const app = Layer.mergeAll(
		routes,
		responsePolicy,
		HttpRouter.add(
			"GET",
			"/api/openapi.json",
			Effect.succeed(HttpServerResponse.jsonUnsafe(OpenApi.fromApi(publicApi))),
		),
		HttpRouter.add("OPTIONS", "/api/icons", Effect.succeed(preflight)),
		HttpRouter.add("OPTIONS", "/api/icons/:slug", Effect.succeed(preflight)),
		HttpRouter.add("OPTIONS", "/api/community", Effect.succeed(preflight)),
		HttpRouter.add("OPTIONS", "/api/community/:slug", Effect.succeed(preflight)),
	).pipe(
		Layer.provide(HttpServer.layerServices),
		// icons.http owns the complete request/export lifetime; an automatic outer span
		// would finish after its export and be held for an unrelated request.
		Layer.provideMerge(Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true)),
		Layer.provideMerge(
			makeWorkersTelemetryLayer({ resource: { serviceName: "sketchi-icons" }, ...options }),
		),
		Layer.provideMerge(Layer.succeed(Scheduler.Scheduler, new Scheduler.MixedScheduler("sync"))),
	);
	const runtime = HttpRouter.toWebHandler(app, {
		disableLogger: true,
		middleware: (effect) =>
			Effect.gen(function* () {
				const request = yield* IconsHttpRequest;
				const incoming = yield* HttpServerRequest.HttpServerRequest;
				return yield* effect.pipe(
					Effect.tap((response) =>
						Effect.gen(function* () {
							yield* Effect.annotateCurrentSpan({
								"http.response.status_code": response.status,
								"http.response.headers": response.headers,
								...(response.body._tag === "Uint8Array"
									? { [SpanContent.httpResponseBody]: new TextDecoder().decode(response.body.body) }
									: {}),
							});
							if (response.status >= 500 && response.status < 600) {
								const span = yield* Effect.currentSpan.pipe(Effect.orDie);
								const now = yield* Clock.currentTimeNanos;
								// Match HTTP server outcome classification without failing the sent response.
								// The error is exported too: reuse the safe headers and omit peer addresses.
								span.end(
									now,
									Exit.fail(
										new HttpServerError.HttpServerError({
											reason: new HttpServerError.ResponseError({
												request: incoming.modify({
													headers: Headers.fromInput(request.headers),
													remoteAddress: Option.none(),
													peerAddress: Option.none(),
												}),
												response,
											}),
										}),
									),
								);
							}
						}),
					),
					withTelemetryExport(request.target),
					Effect.withSpan("icons.http", {
						kind: "server",
						parent: Option.getOrUndefined(HttpTraceContext.fromHeaders(incoming.headers)),
						attributes: {
							"http.request.method": request.method,
							"url.full": request.url,
							"http.request.headers": request.headers,
						},
					}),
					(program) =>
						withTelemetryCorrelation(program, {
							requestId: request.requestId,
							runId: request.runId,
							...(request.rayId ? { rayId: request.rayId } : {}),
						}),
				);
			}),
	});
	return {
		dispose: runtime.dispose,
		fetch(
			request: Request,
			env: IconsHttpEnv,
			execution: { readonly waitUntil: (promise: Promise<unknown>) => void },
		) {
			const requestId = `req_${String.replaceAll("-", "")(SecureRandom.uuidV4Unsafe())}`;
			const runId = `run_${String.replaceAll("-", "")(SecureRandom.uuidV4Unsafe())}`;
			const rayId = request.headers.get("cf-ray");
			return runtime.handler(
				request,
				Context.make(CommunityHttpRequest, { env, origin: new URL(request.url).origin }).pipe(
					Context.add(IconSource, {
						origin: new URL(request.url).origin,
						sourceLoader: createIconSourceLoader(env.ASSETS),
					}),
					Context.add(IconsHttpRequest, {
						target: {
							pipeline: env.TELEMETRY_SPANS,
							waitUntil: (promise) => execution.waitUntil(promise),
						},
						requestId,
						runId,
						...(rayId ? { rayId } : {}),
						method: request.method,
						url: request.url,
						headers: Record.fromEntries(
							Array.filter([...request.headers], ([key]) => telemetryRequestHeaders.includes(key)),
						),
					}),
				),
			);
		},
	};
}
