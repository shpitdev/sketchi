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
import { Array, Context, Effect, Layer, Record, Scheduler, String } from "effect";
import { SecureRandom } from "effect/crypto";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";
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
				return yield* effect.pipe(
					Effect.tap((response) =>
						Effect.annotateCurrentSpan({
							"http.response.status_code": response.status,
							"http.response.headers": response.headers,
							...(response.body._tag === "Uint8Array"
								? { [SpanContent.httpResponseBody]: new TextDecoder().decode(response.body.body) }
								: {}),
						}),
					),
					withTelemetryExport(request.target),
					Effect.withSpan("icons.http", {
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
							Array.filter(
								[...request.headers],
								([key]) =>
									!["authorization", "cookie", "proxy-authorization", "set-cookie"].includes(key),
							),
						),
					}),
				),
			);
		},
	};
}
