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
import { limitClient } from "@sketchi/community-icons";
import { Clock, Effect, Layer, Result } from "effect";

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

// On the sketchi-icons tuning split, Sonnet 5.5 and Opus 5.5 drew equally recognizable icons (28 and 27 of 28 picked
// out of their look-alikes by Sol at 28 px) and Sonnet cost about a fifth less per icon.
const DEFAULT_AUTHOR_MODEL: IconAuthorModel = "anthropic/claude-sonnet-5-5";
const DEFAULT_JUDGE_MODEL = "google/gemini-3.8-flash";

type IconDrawFailureStatus =
	| "invalid_input"
	| "unsupported_model"
	| "provider_failed"
	| "render_failed"
	| "invalid_recipe"
	| "draw_timeout"
	| "rate_limited"
	| "unavailable"
	| "not_configured";

const FAILURE_STATUS: Record<IconDrawFailureStatus, number> = {
	invalid_input: 400,
	unsupported_model: 400,
	invalid_recipe: 422,
	render_failed: 502,
	provider_failed: 502,
	rate_limited: 429,
	not_configured: 503,
	unavailable: 503,
	draw_timeout: 504,
};

/** Draw requests one client address may send a minute, counted by its `ICON_DRAW_CLIENT_LIMIT` object. */
export const ICON_DRAWS_PER_CLIENT_MINUTE = 6;
/** Draws a day across every client when `SKETCHI_ICON_DAILY_DRAWS` is unset: the bound on model spend. */
export const DEFAULT_DAILY_ICON_DRAWS = 200;

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
		case "IconTimeoutError":
			return failure("draw_timeout", {
				code: `${error.stage}_timeout`,
				message: error.message,
				hint: "Retry once; a simpler logo draws faster.",
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
function iconDrawLayer(env: StudioEnv, origin: string, surface: IconDrawSurface) {
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
						surface: `icon-draw-${surface}`,
						judgeModel: envString(env.SKETCHI_ICON_JUDGE_MODEL) ?? DEFAULT_JUDGE_MODEL,
						authorEffort: "low",
					}),
				),
			),
		),
	);
}

export type IconDrawSurface = "api" | "mcp";

export function dailyIconDraws(env: StudioEnv): number {
	const cap = Number(envString(env.SKETCHI_ICON_DAILY_DRAWS));
	return Number.isInteger(cap) && cap >= 0 ? cap : DEFAULT_DAILY_ICON_DRAWS;
}

/** Whole seconds from `now` to the next UTC midnight, when the day's budget starts again. */
export function secondsUntilUtcMidnight(now: number): number {
	const next = new Date(now);
	next.setUTCHours(24, 0, 0, 0);
	return Math.max(1, Math.ceil((next.getTime() - now) / 1000));
}

interface Refusal {
	readonly failure: IconDrawFailure;
	readonly retryAfterSeconds?: number;
}

/**
 * Whether this client may send another draw request: a few a minute, counted for every request
 * it sends, so a flood of malformed ones is turned away as cheaply as a flood of real ones.
 */
const admitClient = Effect.fn("playground.icons.admitClient")(function* (
	env: StudioEnv,
	request: Request,
) {
	const limits = env.ICON_DRAW_CLIENT_LIMIT;
	if (!limits) {
		yield* Effect.annotateCurrentSpan({ "sketchi.icon.client_limit": "unbound" });
		return undefined;
	}
	// A limit object that cannot answer lets the request through; the daily budget still bounds spend.
	const decision = yield* Effect.tryPromise(() =>
		limitClient(limits, request, ICON_DRAWS_PER_CLIENT_MINUTE, 60_000),
	).pipe(Effect.orElseSucceed(() => undefined));
	yield* Effect.annotateCurrentSpan({
		"sketchi.icon.client_limit":
			decision === undefined ? "failed" : decision.allowed ? "allowed" : "refused",
	});
	if (!decision || decision.allowed) return undefined;
	return {
		failure: failure("rate_limited", {
			code: "rate_limited",
			message: `Each client may send ${ICON_DRAWS_PER_CLIENT_MINUTE} icon draw requests a minute.`,
			hint: "Wait for Retry-After, then send the next logo.",
		}),
		retryAfterSeconds: decision.retryAfterSeconds,
	} satisfies Refusal;
});

/**
 * Whether a checked draw may start within the day's budget, which every client shares, so the
 * endpoint's model spend has a ceiling. A draw counts when it is admitted, before any model call.
 */
const admitDraw = Effect.fn("playground.icons.admitDraw")(function* (env: StudioEnv) {
	const now = yield* Clock.currentTimeMillis;
	const budget = env.ICON_DRAW_BUDGET;
	if (budget) {
		// The budget reads the day from its own clock, so a late call never counts against a past day.
		const admitted = yield* Effect.tryPromise(() =>
			budget.getByName("daily").admit(dailyIconDraws(env)),
		).pipe(Effect.result);
		yield* Effect.annotateCurrentSpan({
			"sketchi.icon.daily_draws": Result.isSuccess(admitted) ? admitted.success.used : -1,
		});
		if (Result.isFailure(admitted)) {
			// Without the count the spend is unbounded, so the draw does not start.
			return {
				failure: failure("unavailable", {
					code: "budget_unavailable",
					message: "The daily drawing budget could not be checked.",
					hint: "Retry in a minute.",
				}),
				retryAfterSeconds: 60,
			} satisfies Refusal;
		}
		if (!admitted.success.admitted) {
			return {
				failure: failure("rate_limited", {
					code: "daily_limit",
					message: "Today's icon drawing budget is spent.",
					hint: "Try again after midnight UTC.",
				}),
				retryAfterSeconds: secondsUntilUtcMidnight(now),
			} satisfies Refusal;
		}
	}
	return undefined;
});

export interface DrawOutcome {
	readonly body: IconDrawSuccess | IconDrawFailure;
	readonly retryAfterSeconds?: number;
}

/**
 * One draw from a decoded request body, for the HTTP route and MCP alike: the author model the
 * body names (or the default), the client's rate limit, the input checks, the day's budget, then
 * the draw.
 */
export const drawIconFromBody = Effect.fn("playground.icons.draw")(function* (
	body: unknown,
	surface: IconDrawSurface,
) {
	const env = yield* PlaygroundBindings;
	const metadata = yield* PlaygroundRequestMetadata;
	const done = (
		result: IconDrawSuccess | IconDrawFailure,
		retryAfterSeconds?: number,
	): DrawOutcome => ({
		body: result,
		...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
	});
	const requestedModel =
		typeof body === "object" && body !== null && "model" in body
			? (body as { model?: unknown }).model
			: undefined;
	const authorModel =
		requestedModel === undefined
			? (iconAuthorModel(envString(env.SKETCHI_ICON_AUTHOR_MODEL) ?? "") ?? DEFAULT_AUTHOR_MODEL)
			: typeof requestedModel === "string"
				? iconAuthorModel(requestedModel)
				: undefined;
	if (!authorModel) {
		return done(
			failure("unsupported_model", {
				code: "unsupported_model",
				message: "That author model is not available for drawing icons.",
				hint: `Omit model, or send one of ${ICON_AUTHOR_MODELS.join(", ")}.`,
			}),
		);
	}
	const layer = iconDrawLayer(env, metadata.origin, surface);
	if (!layer) {
		return done(
			failure("not_configured", {
				code: "not_configured",
				message: "Icon drawing is not configured on this deployment.",
				hint: "Use the hosted service at sketchi.app.",
			}),
		);
	}
	const limited = yield* admitClient(env, metadata.request);
	if (limited) return done(limited.failure, limited.retryAfterSeconds);
	const input = yield* prepareIconInput(body).pipe(Effect.result);
	if (Result.isFailure(input)) return done(errorFailure(input.failure));
	const refusal = yield* admitDraw(env);
	if (refusal) return done(refusal.failure, refusal.retryAfterSeconds);
	const outcome = yield* drawIcon(input.success, { authorModel }).pipe(
		Effect.provide(layer),
		Effect.result,
	);
	if (Result.isFailure(outcome)) {
		yield* Effect.annotateCurrentSpan({ "sketchi.icon.failure": outcome.failure._tag });
		return done(errorFailure(outcome.failure));
	}
	return done({ ok: true, status: "drawn", ...outcome.success });
});

/**
 * `POST /api/v1/icons/draw`: a logo (SVG or raster) and its name in, Sketchi's
 * hand-drawn recipe out, with previews, an Excalidraw library and the judge's
 * verdict. No account; one synchronous request.
 */
export const handleDrawIconRequest = Effect.fn("playground.http.drawIcon")(function* (
	request: Request,
) {
	const clock = yield* PlaygroundClock;
	const usage = yield* PlaygroundCodeModeUsage;
	const usageContext: CodeModeUsageContext = yield* usage.createContext;
	const startedAt = yield* clock.nowMillis;
	let requestBody: Record<string, unknown> = {};
	const respond = (body: IconDrawSuccess | IconDrawFailure, retryAfterSeconds?: number) =>
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
			if (retryAfterSeconds !== undefined) headers.set("Retry-After", String(retryAfterSeconds));
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
	const outcome = yield* drawIconFromBody(bounded.body, "api");
	return yield* respond(outcome.body, outcome.retryAfterSeconds);
});

/**
 * What an agent's Code Mode script gets back from `sketchi.drawIcon`: the recipe, the judge's
 * verdict and the palette. The PNGs and the library stay out of the agent's context; the HTTP
 * API and CLI return them.
 */
export const drawIconForAgent = Effect.fn("playground.icons.drawForAgent")(function* (
	request: unknown,
) {
	const outcome = yield* drawIconFromBody(request, "mcp");
	if (!outcome.body.ok) {
		return outcome.retryAfterSeconds === undefined
			? outcome.body
			: { ...outcome.body, retryAfterSeconds: outcome.retryAfterSeconds };
	}
	const { name, recipe, judge, palette, author, usage } = outcome.body;
	return {
		ok: true as const,
		status: "drawn" as const,
		name,
		recipe,
		judge: { recognizable: judge.recognizable, ...(judge.picked ? { picked: judge.picked } : {}) },
		palette,
		author: { model: author.model, rounds: author.rounds },
		usage: { calls: usage.calls, ms: usage.ms },
	};
});
