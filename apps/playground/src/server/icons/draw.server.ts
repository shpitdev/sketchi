import "@tanstack/react-start/server-only";

import { CloudflareAiGatewayBinding } from "@sketchi/diagram-generation";
import {
	drawIcon,
	ICON_AUTHOR_MODELS,
	ICON_DRAW_REQUEST_MAX_BYTES,
	IconCatalogSvgs,
	type IconDrawError,
	IconDrawGatewayConfig,
	IconDrawModelsGateway,
	type IconDrawResult,
	IconImaging,
	IconImagingError,
	iconAuthorModel,
	type IconAuthorModel,
	type IconImagingJob,
	prepareIconInput,
} from "@sketchi/icon-draw";
import { Effect, Layer, Result } from "effect";

import { aiEnvironment } from "../bindings/ai-env.server";
import type { StudioEnv } from "../bindings/studio-env.server";
import {
	browserRenderingRetrySchedule,
	BrowserRenderingFailure,
	browserFailure,
} from "../codemode/browser-render-pool.server";
import {
	browserRunCaller,
	browserRunHarnessUrl,
	type CodeModePngRendererNamespace,
} from "../codemode/browser-renderer.server";
import {
	NODE_LOGO_ASSET_PATH,
	type PlaygroundAssetsBinding,
} from "../codemode/icon-catalog.server";
import { rendererOptions } from "../codemode/service.server";
import {
	codeModeUsageResponseHeaders,
	type CodeModeUsageContext,
	PlaygroundCodeModeUsage,
} from "../codemode/usage-events.server";
import {
	PlaygroundBindings,
	PlaygroundClock,
	PlaygroundRequestMetadata,
} from "../runtime/context.server";
import { readBoundedJson } from "../runtime/request-body.server";

const DEFAULT_AUTHOR_MODEL: IconAuthorModel = "anthropic/claude-opus-5-5";
const DEFAULT_JUDGE_MODEL = "google/gemini-3.8-flash";

type IconDrawFailureStatus =
	| "invalid_input"
	| "unsupported_model"
	| "provider_failed"
	| "render_failed"
	| "invalid_recipe"
	| "not_configured";

const FAILURE_STATUS: Record<IconDrawFailureStatus, number> = {
	invalid_input: 400,
	unsupported_model: 400,
	invalid_recipe: 422,
	render_failed: 502,
	provider_failed: 502,
	not_configured: 503,
};

interface IconDrawIssue {
	readonly code: string;
	readonly message: string;
	readonly hint: string;
}

export interface IconDrawFailure {
	readonly ok: false;
	readonly status: IconDrawFailureStatus;
	readonly issues: readonly IconDrawIssue[];
}

export interface IconDrawSuccess extends Omit<IconDrawResult, "usage"> {
	readonly ok: true;
	readonly status: "drawn";
	readonly usage: IconDrawResult["usage"];
}

function failure(status: IconDrawFailureStatus, issue: IconDrawIssue): IconDrawFailure {
	return { ok: false, status, issues: [issue] };
}

function statusCode(body: IconDrawSuccess | IconDrawFailure): number {
	return body.ok ? 200 : FAILURE_STATUS[body.status];
}

/** What usage telemetry keeps of a request: never the uploaded file. */
function requestSummary(body: unknown): Record<string, unknown> {
	if (typeof body !== "object" || body === null) return {};
	const { name, svg, image, model } = body as Record<string, unknown>;
	return {
		...(typeof name === "string" ? { name: name.slice(0, 64) } : {}),
		...(typeof svg === "string" ? { svgBytes: svg.length } : {}),
		...(typeof image === "string" ? { imageBase64Bytes: image.length } : {}),
		...(typeof model === "string" ? { model: model.slice(0, 64) } : {}),
	};
}

/** What usage telemetry keeps of a response: the recipe and verdict, not the images. */
function responseSummary(body: IconDrawSuccess | IconDrawFailure): unknown {
	if (!body.ok) return body;
	const { previews: _previews, excalidrawlib: _library, ...rest } = body;
	return rest;
}

function errorFailure(error: IconDrawError): IconDrawFailure {
	switch (error._tag) {
		case "IconInputError":
			return failure("invalid_input", {
				code: error.code,
				message: error.message,
				hint: error.hint,
			});
		case "IconModelError":
			return failure("provider_failed", {
				code: `${error.role}_failed`,
				message: error.message,
				hint: "Retry once; if it persists, try again later.",
			});
		case "IconImagingError":
			return failure("render_failed", {
				code: `${error.stage}_failed`,
				message: error.message,
				hint: "Retry once; if it persists, send the logo as a PNG.",
			});
		case "IconRecipeError":
			return failure("invalid_recipe", {
				code: "no_drawable_recipe",
				message: [error.message, ...error.issues.slice(0, 4)].join(" "),
				hint: "Retry; a simpler or larger source logo helps.",
			});
	}
}

/** Logo decoding and scene export on Browser Rendering's warm harness pages. */
function browserRunImaging(renderers: CodeModePngRendererNamespace, harnessUrl: string) {
	return Layer.succeed(IconImaging, {
		run: (job: IconImagingJob) =>
			browserRunCaller.pipe(
				Effect.flatMap((caller) =>
					Effect.tryPromise({
						try: async () => {
							const renderer = renderers.getByName(harnessUrl);
							if (!renderer.runIconJob) throw new Error("The renderer cannot run icon jobs.");
							return renderer.runIconJob({ harnessUrl, job }, caller);
						},
						catch: browserFailure("durableObject"),
					}),
				),
				Effect.retry(browserRenderingRetrySchedule),
				Effect.flatMap((result) =>
					result._tag === "Done"
						? Effect.succeed(result.result)
						: Effect.fail(
								BrowserRenderingFailure.make({
									cause: new Error(result.message),
									message: result.message,
									operation: result.operation,
								}),
							),
				),
				Effect.mapError((error) =>
					IconImagingError.make({
						cause: error,
						message: `Browser Rendering failed: ${error.message}`,
						stage: job.exports.length > 0 ? "export" : "prepare",
					}),
				),
				Effect.withSpan("playground.icons.imaging", {
					attributes: { prepare: job.prepare.length, exports: job.exports.length },
				}),
			),
	});
}

/** Catalog marks from the Worker's static node-logo assets. */
function assetCatalogSvgs(assets: PlaygroundAssetsBinding, origin: string) {
	return Layer.succeed(IconCatalogSvgs, {
		load: (slug: string) =>
			Effect.tryPromise({
				try: async (signal) => {
					const response = await assets.fetch(
						new URL(`${NODE_LOGO_ASSET_PATH}${encodeURIComponent(slug)}.svg`, origin),
						{ signal },
					);
					return response.ok ? response.text() : undefined;
				},
				catch: () => undefined,
			}).pipe(Effect.orElseSucceed(() => undefined)),
	});
}

function envString(value: string | undefined): string | undefined {
	return value?.trim() || undefined;
}

/** The services a draw needs, from this Worker's bindings; undefined when one is missing. */
function iconDrawLayer(env: StudioEnv, origin: string) {
	if (!env.AI || !env.CODEMODE_PNG_RENDERER || !env.ASSETS) return undefined;
	const harnessUrl = browserRunHarnessUrl(rendererOptions(env, origin));
	return Layer.mergeAll(
		browserRunImaging(env.CODEMODE_PNG_RENDERER, harnessUrl),
		assetCatalogSvgs(env.ASSETS, origin),
		IconDrawModelsGateway.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(CloudflareAiGatewayBinding, env.AI),
					Layer.succeed(IconDrawGatewayConfig, {
						gatewayId: aiEnvironment(env).gatewayId,
						collectLog: true,
						surface: "icon-draw-api",
						judgeModel: envString(env.SKETCHI_ICON_JUDGE_MODEL) ?? DEFAULT_JUDGE_MODEL,
						authorEffort: "low",
					}),
				),
			),
		),
	);
}

/**
 * `POST /api/v1/icons/draw`: a logo (SVG or raster) and its name in, Sketchi's
 * hand-drawn recipe out, with previews, an Excalidraw library and the judge's
 * verdict. No account; one synchronous request.
 */
export const handleDrawIconRequest = Effect.fn("playground.http.drawIcon")(function* (
	request: Request,
) {
	const env = yield* PlaygroundBindings;
	const metadata = yield* PlaygroundRequestMetadata;
	const clock = yield* PlaygroundClock;
	const usage = yield* PlaygroundCodeModeUsage;
	const usageContext: CodeModeUsageContext = yield* usage.createContext;
	const startedAt = yield* clock.nowMillis;
	let requestBody: Record<string, unknown> = {};
	const respond = (body: IconDrawSuccess | IconDrawFailure) =>
		Effect.gen(function* () {
			const finishedAt = yield* clock.nowMillis;
			yield* usage.capture({
				context: usageContext,
				durationMs: finishedAt - startedAt,
				operation: "drawIcon",
				requestBody,
				responseBody: responseSummary(body),
				statusCode: statusCode(body),
				surface: "api",
			});
			const headers = new Headers(codeModeUsageResponseHeaders(usageContext));
			headers.set("Cache-Control", "no-store");
			return Response.json(body, { status: statusCode(body), headers });
		});

	const bounded = yield* readBoundedJson(request, ICON_DRAW_REQUEST_MAX_BYTES, {
		recordBody: false,
	});
	if (bounded._tag !== "Body") {
		return yield* respond(
			failure("invalid_input", {
				code: bounded._tag === "TooLarge" ? "request_too_large" : "invalid_json",
				message:
					bounded._tag === "TooLarge"
						? `The request exceeds ${Math.round(ICON_DRAW_REQUEST_MAX_BYTES / (1024 * 1024))} MB.`
						: "The request body was not valid JSON.",
				hint: 'Send { "name": "Acme", "svg": "<svg ...>" } or { "name": "Acme", "image": "<base64 PNG>" }.',
			}),
		);
	}
	requestBody = requestSummary(bounded.body);
	const requestedModel =
		typeof bounded.body === "object" && bounded.body !== null && "model" in bounded.body
			? (bounded.body as { model?: unknown }).model
			: undefined;
	const authorModel =
		requestedModel === undefined
			? (iconAuthorModel(envString(env.SKETCHI_ICON_AUTHOR_MODEL) ?? "") ?? DEFAULT_AUTHOR_MODEL)
			: typeof requestedModel === "string"
				? iconAuthorModel(requestedModel)
				: undefined;
	if (!authorModel) {
		return yield* respond(
			failure("unsupported_model", {
				code: "unsupported_model",
				message: "That author model is not available for drawing icons.",
				hint: `Omit model, or send one of ${ICON_AUTHOR_MODELS.join(", ")}.`,
			}),
		);
	}
	const layer = iconDrawLayer(env, metadata.origin);
	if (!layer) {
		return yield* respond(
			failure("not_configured", {
				code: "not_configured",
				message: "Icon drawing is not configured on this deployment.",
				hint: "Use the hosted service at sketchi.app.",
			}),
		);
	}
	const outcome = yield* prepareIconInput(bounded.body).pipe(
		Effect.flatMap((input) => drawIcon(input, { authorModel })),
		Effect.provide(layer),
		Effect.result,
	);
	if (Result.isFailure(outcome)) {
		yield* Effect.annotateCurrentSpan({ "sketchi.icon.failure": outcome.failure._tag });
		return yield* respond(errorFailure(outcome.failure));
	}
	return yield* respond({ ok: true, status: "drawn", ...outcome.success });
});
