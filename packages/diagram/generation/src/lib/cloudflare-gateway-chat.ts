import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { SpanContent, TelemetryCorrelation } from "@sketchi/observability";
import { Clock, Context, Effect, Layer, Option, Result } from "effect";
import { type AiError, LanguageModel, Prompt, type Response as AiResponse } from "effect/ai";
import { FetchHttpClient, HttpClient } from "effect/http";

import {
	candidateFromText,
	type DiagramGenerationProviderId,
	type DiagramGenerationRequest,
	responseErrorDiagnostic,
} from "./candidates.js";
import { DiagramGenerationClient, DiagramGenerationPolicy } from "./client.js";
import {
	type CloudflareAiGateway,
	CloudflareAiGatewayBinding,
	isTransientHttpStatus,
	parseJsonResponse,
} from "./cloudflare-ai-gateway.js";
import {
	DiagramGenerationHttpError,
	DiagramGenerationLimitError,
	DiagramGenerationResponseError,
	DiagramGenerationTransportError,
	errorMessage,
} from "./errors.js";
import {
	buildDiagramGenerationMessages,
	DEFAULT_MAX_OUTPUT_TOKENS,
	DEFAULT_TEMPERATURE,
	revisesFlowchartWithEdits,
} from "./messages.js";
import { stripAnthropicModelPrefix, stripGoogleModelPrefix } from "./models.js";
import { DiagramFamilyNarrowing } from "./family-narrowing.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";

// The gateway fetch below never dials this. It only satisfies the client's URL handling.
const GATEWAY_FETCH_API_URL = "https://sketchi-gateway.invalid";

/** One upstream reached through `gateway.run`, using the key stored on the gateway. */
export interface GatewayChatRoute {
	readonly endpoint: string;
	readonly gatewayLabel: string;
	readonly gatewayProvider: string;
	readonly modelId: (model: string) => string;
	readonly modelLabel: string;
	readonly provider: DiagramGenerationProviderId;
	/** What this upstream takes beyond the model, messages and output budget. */
	readonly requestFields: (request: DiagramGenerationRequest) => Record<string, unknown>;
}

export const googleGatewayChatRoute: GatewayChatRoute = {
	endpoint: "v1beta/openai/chat/completions",
	gatewayLabel: "Google AI Studio",
	gatewayProvider: "google-ai-studio",
	modelId: stripGoogleModelPrefix,
	modelLabel: "Gemini",
	provider: "cloudflare-google-ai-studio",
	requestFields: (request) => ({
		response_format: { type: "json_object" },
		temperature: request.temperature ?? DEFAULT_TEMPERATURE,
	}),
};

export const anthropicGatewayChatRoute: GatewayChatRoute = {
	endpoint: "v1/chat/completions",
	gatewayLabel: "Anthropic",
	gatewayProvider: "anthropic",
	modelId: stripAnthropicModelPrefix,
	modelLabel: "Claude",
	provider: "cloudflare-anthropic",
	// Haiku rejects `temperature` and a `json_object` format, and rejects our response schema
	// as `json_schema`: `diagram` is open and the IR is recursive. The prompt asks for JSON and
	// the parser is tolerant. On a new diagram, thinking doubled tokens and latency without raising
	// acceptance; a flowchart revision thinks instead, through the Messages API (runMessagesAttempt).
	requestFields: () => ({ thinking: { type: "disabled" } }),
};

/** The route for a model id, named by its prefix. Unprefixed ids are Google's. */
export function gatewayChatRouteForModel(model: string): GatewayChatRoute {
	return model.startsWith("anthropic/") ? anthropicGatewayChatRoute : googleGatewayChatRoute;
}

export interface CloudflareGatewayChatConfigValue {
	readonly collectLog: boolean;
	readonly gatewayId: string;
	readonly route: GatewayChatRoute;
	readonly surface: string;
}

export class CloudflareGatewayChatConfig extends Context.Service<
	CloudflareGatewayChatConfig,
	CloudflareGatewayChatConfigValue
>()("@sketchi/diagram-generation/CloudflareGatewayChatConfig") {}

// Synchronous, so an interrupted attempt cannot reach `gateway.run` after it was aborted.
function decodeRequestBody(body: BodyInit | null | undefined): unknown {
	if (typeof body === "string") return JSON.parse(body);
	if (ArrayBuffer.isView(body)) return JSON.parse(new TextDecoder().decode(body));
	throw new TypeError("The chat client sent an unexpected request body.");
}

/** What the gateway answered, as it arrived. */
interface GatewayReply {
	body?: string;
	logId?: string;
	status?: number;
}

function gatewayFetch(
	gateway: CloudflareAiGateway,
	config: CloudflareGatewayChatConfigValue,
	request: DiagramGenerationRequest,
	traceId: string | undefined,
	reply: GatewayReply,
): typeof globalThis.fetch {
	return async (_input, init) => {
		const response = await gateway.run(
			{
				endpoint: config.route.endpoint,
				headers: { "Content-Type": "application/json" },
				provider: config.route.gatewayProvider,
				query: decodeRequestBody(init?.body),
			},
			{
				gateway: {
					collectLog: config.collectLog,
					// AI Gateway keeps five metadata entries per request and drops the rest.
					metadata: {
						scenarioId: request.prompt.id,
						sketchiProvider: config.route.provider,
						sketchiSurface: config.surface,
						...(traceId ? { sketchiTraceId: traceId } : {}),
					},
					// Someone who sends the same request again wants another diagram, and an
					// evaluation sample has to be a real draw, so no call replays a cached answer.
					skipCache: true,
				},
				...(init?.signal ? { signal: init.signal } : {}),
			},
		);
		const logId = response.headers.get("cf-aig-log-id");
		if (logId) reply.logId = logId;
		reply.status = response.status;
		if (!response.body) return response;
		// Read the body here so a broken stream fails as transport and is retried. Past this
		// point the client reports read failures and unparseable JSON as the same error.
		const body = await response.text();
		reply.body = body;
		return new Response(body, {
			headers: response.headers,
			status: response.status,
		});
	};
}

/** The binding's own failure, under the NetworkError and HttpClientError wrappers. */
function transportFailure(networkError: AiError.NetworkError): unknown {
	const httpError: unknown = networkError.cause;
	const reason =
		typeof httpError === "object" && httpError !== null && "reason" in httpError
			? httpError.reason
			: undefined;
	return typeof reason === "object" && reason !== null && "cause" in reason
		? reason.cause
		: networkError;
}

const tokenCount = (count: number) => count.toLocaleString("en-US");

function emptyResponseError(route: GatewayChatRoute, cause: unknown) {
	return DiagramGenerationResponseError.make({
		cause,
		message: `${route.modelLabel} response did not include text content.`,
		provider: route.provider,
	});
}

function mapAiError(
	error: AiError.AiError,
	route: GatewayChatRoute,
	durationMs: number,
): DiagramGenerationHttpError | DiagramGenerationResponseError | DiagramGenerationTransportError {
	const reason = error.reason;
	if (reason._tag === "NetworkError") {
		const cause = transportFailure(reason);
		return DiagramGenerationTransportError.make({
			cause,
			message: errorMessage(cause, "Generation request failed."),
			operation: "gateway.run",
			provider: route.provider,
			retryable: true,
		});
	}
	const http = "http" in reason ? reason.http : undefined;
	const status = http?.response?.status;
	if (status === undefined) return emptyResponseError(route, reason);
	// Google's OpenAI-compatible endpoint wraps its error object in an array.
	const body = parseJsonResponse(http?.body ?? "");
	const raw: unknown = Array.isArray(body) ? body[0] : body;
	const diagnostic = responseErrorDiagnostic(raw);
	return DiagramGenerationHttpError.make({
		diagnostics: [
			`${route.gatewayLabel} Gateway request failed with HTTP ${status}.`,
			...(diagnostic ? [diagnostic] : []),
		],
		durationMs,
		provider: route.provider,
		raw,
		// From the status, not `reason.isRetryable`, which treats 408, 425 and quota 429s differently.
		retryable: isTransientHttpStatus(status),
		status,
	});
}

/** OpenTelemetry GenAI message parts for what the model returned. */
function outputParts(content: ReadonlyArray<AiResponse.AllParts<never>>) {
	return content.flatMap((part): unknown[] => {
		if (part.type === "text" || part.type === "reasoning") {
			return [{ type: part.type, content: part.text }];
		}
		if (part.type === "finish" || part.type === "response-metadata") return [];
		return [part];
	});
}

function usageAttributes(usage: AiResponse.Usage): Record<string, number> {
	const values = {
		"gen_ai.usage.input_tokens": usage.inputTokens.total,
		"gen_ai.usage.output_tokens": usage.outputTokens.total,
		"gen_ai.usage.cache_read.input_tokens": usage.inputTokens.cacheRead,
		"gen_ai.usage.cache_creation.input_tokens": usage.inputTokens.cacheWrite,
		"gen_ai.usage.reasoning.output_tokens": usage.outputTokens.reasoning,
	};
	return Object.fromEntries(
		Object.entries(values).filter((entry): entry is [string, number] => entry[1] !== undefined),
	);
}

const runChatAttempt = Effect.fn("diagramGeneration.gatewayChat.attempt")(function* (
	model: Context.Service.Shape<typeof LanguageModel.LanguageModel>,
	gateway: CloudflareAiGateway,
	config: CloudflareGatewayChatConfigValue,
	request: DiagramGenerationRequest,
) {
	const { route } = config;
	const startedAt = yield* Clock.currentTimeMillis;
	const correlation = yield* TelemetryCorrelation;
	const span = yield* Effect.option(Effect.currentSpan);
	const traceId = correlation.traceId ?? Option.getOrUndefined(span)?.traceId;
	const reply: GatewayReply = {};
	const { system, user } = buildDiagramGenerationMessages(request.prompt);
	const modelId = route.modelId(request.model);
	const maxOutputTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
	const requestFields = route.requestFields(request);
	// OpenTelemetry GenAI attributes, recorded before the call so a failed call keeps them.
	yield* Effect.annotateCurrentSpan({
		"gen_ai.input.messages": [{ role: "user", parts: [{ type: "text", content: user }] }],
		"gen_ai.operation.name": "chat",
		"gen_ai.provider.name": route.gatewayProvider,
		"gen_ai.request.max_tokens": maxOutputTokens,
		"gen_ai.request.model": modelId,
		...(typeof requestFields["temperature"] === "number"
			? { "gen_ai.request.temperature": requestFields["temperature"] }
			: {}),
		"gen_ai.system_instructions": [{ type: "text", content: system }],
		"sketchi.gateway.request_fields": requestFields,
	});
	const response = yield* LanguageModel.generateText({
		prompt: Prompt.make([
			{ role: "system", content: system },
			{ role: "user", content: [{ type: "text", text: user }] },
		]),
	}).pipe(
		OpenAiLanguageModel.withConfigOverride({
			max_output_tokens: maxOutputTokens,
			model: modelId,
			...requestFields,
		}),
		Effect.provideService(LanguageModel.LanguageModel, model),
		Effect.provideService(
			FetchHttpClient.Fetch,
			gatewayFetch(gateway, config, request, traceId, reply),
		),
		// The attempt span already times this call, and its URL is not a real address.
		Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
		Effect.ensuring(
			Effect.suspend(() =>
				Effect.annotateCurrentSpan({
					...(reply.logId ? { gateway_log_id: reply.logId } : {}),
					...(reply.status === undefined ? {} : { "http.response.status_code": reply.status }),
					...(reply.body === undefined ? {} : { [SpanContent.httpResponseBody]: reply.body }),
				}),
			),
		),
		Effect.catchTag("AiError", (error) =>
			Effect.flatMap(Clock.currentTimeMillis, (finishedAt) =>
				Effect.fail(mapAiError(error, route, Math.round(finishedAt - startedAt))),
			),
		),
	);

	const metadata = response.content.find((part) => part.type === "response-metadata");
	yield* Effect.annotateCurrentSpan({
		"gen_ai.output.messages": [
			{
				finish_reason: response.finishReason,
				parts: outputParts(response.content),
				role: "assistant",
			},
		],
		"gen_ai.response.finish_reasons": [response.finishReason],
		...(metadata?.id ? { "gen_ai.response.id": metadata.id } : {}),
		...(metadata?.modelId ? { "gen_ai.response.model": metadata.modelId } : {}),
		...usageAttributes(response.usage),
	});
	const { inputTokens, outputTokens } = response.usage;
	// A cut-off answer is incomplete, not malformed: repairing or regenerating it
	// under the same budget would only be cut off again.
	if (response.finishReason === "length") {
		return yield* DiagramGenerationLimitError.make({
			diagnostics: [
				`output_truncated: ${route.modelLabel} stopped at the ${tokenCount(maxOutputTokens)}-token output limit${outputTokens.total === undefined ? "" : ` after ${tokenCount(outputTokens.total)} tokens`}.`,
			],
			limit: "output_tokens",
			message: `The diagram needs more than the ${tokenCount(maxOutputTokens)}-token output limit allows in one answer.`,
			provider: route.provider,
		});
	}
	const text = response.text.trim();
	if (!text) {
		return yield* emptyResponseError(route, new Error(`Finish reason: ${response.finishReason}`));
	}
	return candidateFromText(
		{
			diagnostics: [],
			model: modelId,
			provider: route.provider,
			text,
			...(inputTokens.total !== undefined && outputTokens.total !== undefined
				? {
						usage: {
							inputTokens: inputTokens.total,
							outputTokens: outputTokens.total,
							totalTokens: inputTokens.total + outputTokens.total,
						},
					}
				: {}),
		},
		request.prompt.base,
	);
});

/**
 * How a flowchart revision thinks on Claude. Writing edits against a document by id is where
 * thinking pays: on the sketchi-edit tuning revisions it took Haiku from 48/60 to 56/60, for about
 * 350 more output tokens and 1.5 s. A new diagram gains nothing from it, so only revisions think.
 * The OpenAI-compatible endpoint refuses adaptive thinking, so these go to the native Messages API.
 */
const REVISION_THINKING = {
	thinking: { type: "adaptive" },
	output_config: { effort: "medium" },
} as const;

/** The text and usage of a native Messages API reply. */
interface MessagesReply {
	readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
	readonly id?: string;
	readonly model?: string;
	readonly stop_reason?: string;
	readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

const runMessagesAttempt = Effect.fn("diagramGeneration.gatewayMessages.attempt")(function* (
	gateway: CloudflareAiGateway,
	config: CloudflareGatewayChatConfigValue,
	request: DiagramGenerationRequest,
) {
	const { route } = config;
	const startedAt = yield* Clock.currentTimeMillis;
	const correlation = yield* TelemetryCorrelation;
	const span = yield* Effect.option(Effect.currentSpan);
	const traceId = correlation.traceId ?? Option.getOrUndefined(span)?.traceId;
	const { system, user } = buildDiagramGenerationMessages(request.prompt);
	const modelId = route.modelId(request.model);
	const maxOutputTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
	yield* Effect.annotateCurrentSpan({
		"gen_ai.input.messages": [{ role: "user", parts: [{ type: "text", content: user }] }],
		"gen_ai.operation.name": "chat",
		"gen_ai.provider.name": route.gatewayProvider,
		"gen_ai.request.max_tokens": maxOutputTokens,
		"gen_ai.request.model": modelId,
		"gen_ai.system_instructions": [{ type: "text", content: system }],
		"sketchi.gateway.request_fields": REVISION_THINKING,
	});
	const response = yield* Effect.tryPromise({
		try: async (signal) => {
			const reply = await gateway.run(
				{
					endpoint: "v1/messages",
					headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
					provider: route.gatewayProvider,
					query: {
						model: modelId,
						max_tokens: maxOutputTokens,
						system,
						messages: [{ role: "user", content: user }],
						...REVISION_THINKING,
					},
				},
				{
					gateway: {
						collectLog: config.collectLog,
						metadata: {
							scenarioId: request.prompt.id,
							sketchiProvider: route.provider,
							sketchiSurface: config.surface,
							...(traceId ? { sketchiTraceId: traceId } : {}),
						},
						skipCache: true,
					},
					signal,
				},
			);
			return {
				body: await reply.text(),
				logId: reply.headers.get("cf-aig-log-id"),
				status: reply.status,
			};
		},
		catch: (cause) =>
			DiagramGenerationTransportError.make({
				cause,
				message: errorMessage(cause, "Generation request failed."),
				operation: "gateway.run",
				provider: route.provider,
				retryable: true,
			}),
	});
	const finishedAt = yield* Clock.currentTimeMillis;
	yield* Effect.annotateCurrentSpan({
		...(response.logId ? { gateway_log_id: response.logId } : {}),
		"http.response.status_code": response.status,
		[SpanContent.httpResponseBody]: response.body,
	});
	const raw = parseJsonResponse(response.body);
	if (response.status < 200 || response.status >= 300) {
		const diagnostic = responseErrorDiagnostic(raw);
		return yield* DiagramGenerationHttpError.make({
			diagnostics: [
				`${route.gatewayLabel} Gateway request failed with HTTP ${response.status}.`,
				...(diagnostic ? [diagnostic] : []),
			],
			durationMs: Math.round(finishedAt - startedAt),
			provider: route.provider,
			raw,
			retryable: isTransientHttpStatus(response.status),
			status: response.status,
		});
	}
	const reply = raw as MessagesReply;
	const inputTokens = reply.usage?.input_tokens;
	const outputTokens = reply.usage?.output_tokens;
	const text = (reply.content ?? [])
		.flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
		.join("")
		.trim();
	yield* Effect.annotateCurrentSpan({
		"gen_ai.output.messages": [
			{
				finish_reason: reply.stop_reason,
				parts: [{ type: "text", content: text }],
				role: "assistant",
			},
		],
		"gen_ai.response.finish_reasons": [reply.stop_reason],
		...(reply.id ? { "gen_ai.response.id": reply.id } : {}),
		...(reply.model ? { "gen_ai.response.model": reply.model } : {}),
		...(inputTokens === undefined ? {} : { "gen_ai.usage.input_tokens": inputTokens }),
		...(outputTokens === undefined ? {} : { "gen_ai.usage.output_tokens": outputTokens }),
	});
	// A cut-off answer is incomplete, not malformed, as on the chat route.
	if (reply.stop_reason === "max_tokens") {
		return yield* DiagramGenerationLimitError.make({
			diagnostics: [
				`output_truncated: ${route.modelLabel} stopped at the ${tokenCount(maxOutputTokens)}-token output limit${outputTokens === undefined ? "" : ` after ${tokenCount(outputTokens)} tokens`}.`,
			],
			limit: "output_tokens",
			message: `The diagram needs more than the ${tokenCount(maxOutputTokens)}-token output limit allows in one answer.`,
			provider: route.provider,
		});
	}
	if (!text) {
		return yield* emptyResponseError(route, new Error(`Stop reason: ${reply.stop_reason}`));
	}
	return candidateFromText(
		{
			diagnostics: [],
			model: modelId,
			provider: route.provider,
			text,
			...(inputTokens !== undefined && outputTokens !== undefined
				? { usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } }
				: {}),
		},
		request.prompt.base,
	);
});

export const CloudflareGatewayChatClientLive = Layer.effect(DiagramGenerationClient)(
	Effect.gen(function* () {
		const ai = yield* CloudflareAiGatewayBinding;
		const config = yield* CloudflareGatewayChatConfig;
		const policy = yield* DiagramGenerationPolicy;
		// Without it, an untyped request is routed by its words alone.
		const narrowing = Option.getOrUndefined(yield* Effect.serviceOption(DiagramFamilyNarrowing));
		const { provider } = config.route;
		const client = yield* OpenAiClient.make({ apiUrl: GATEWAY_FETCH_API_URL }).pipe(
			Effect.provide(FetchHttpClient.layer),
		);
		const model = yield* OpenAiLanguageModel.make({ model: "set-per-request" }).pipe(
			Effect.provideService(OpenAiClient.OpenAiClient, client),
		);
		const gateway = yield* Effect.result(
			Effect.try({
				try: () => ai.gateway(config.gatewayId),
				catch: (cause) =>
					DiagramGenerationTransportError.make({
						cause,
						message: errorMessage(cause, "AI Gateway could not be initialized."),
						operation: "ai.gateway",
						provider,
						retryable: false,
					}),
			}),
		);
		return {
			provider,
			generate: Effect.fn("diagramGeneration.generate")(function* (
				request: DiagramGenerationRequest,
			) {
				yield* Effect.annotateCurrentSpan({
					model: request.model,
					provider,
					"sketchi.scenario_id": request.prompt.id,
				});
				return yield* runDiagramGenerationWithPolicy(
					(attemptRequest) =>
						Result.isFailure(gateway)
							? Effect.fail(gateway.failure)
							: // A flowchart revision on Claude thinks; every other request does not.
								config.route.gatewayProvider === "anthropic" &&
								  revisesFlowchartWithEdits(attemptRequest.prompt)
								? runMessagesAttempt(gateway.success, config, attemptRequest)
								: runChatAttempt(model, gateway.success, config, attemptRequest),
					request,
					provider,
					policy,
					narrowing,
				);
			}),
		};
	}),
);
