import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai-compat";
import { SpanContent, TelemetryCorrelation } from "@sketchi/observability";
import { Clock, Context, Effect, Layer, Option, Result } from "effect";
import { type AiError, LanguageModel, Prompt, type Response as AiResponse } from "effect/ai";
import { HttpClient } from "effect/http";

import {
	candidateFromText,
	type DiagramGenerationProviderId,
	type DiagramGenerationRequest,
	responseErrorDiagnostic,
} from "./candidates";
import { DiagramGenerationClient, DiagramGenerationPolicy } from "./client";
import {
	type CloudflareAiGateway,
	CloudflareAiGatewayBinding,
	isTransientHttpStatus,
	makeGatewayHttpClient,
	parseJsonResponse,
	stripAnthropicModelPrefix,
	stripGoogleModelPrefix,
} from "@sketchi/cloudflare/ai-gateway";
import {
	DiagramGenerationHttpError,
	DiagramGenerationLimitError,
	DiagramGenerationResponseError,
	DiagramGenerationTransportError,
	errorMessage,
} from "./errors";
import {
	buildDiagramGenerationMessages,
	DEFAULT_MAX_OUTPUT_TOKENS,
	DEFAULT_TEMPERATURE,
} from "./messages";

import { DiagramFamilyNarrowing } from "./family-narrowing";
import { runDiagramGenerationWithPolicy } from "./policy";

// The gateway client never dials this. Only its path, the gateway endpoint, is sent.
const GATEWAY_API_URL = "https://sketchi-gateway.invalid";

/** One upstream reached through `gateway.run`, using the key stored on the gateway. */
export interface GatewayChatRoute {
	/** The upstream's path before `/chat/completions`. */
	readonly apiPath: string;
	readonly gatewayLabel: string;
	readonly gatewayProvider: string;
	readonly modelId: (model: string) => string;
	readonly modelLabel: string;
	readonly provider: DiagramGenerationProviderId;
	/** What this upstream takes beyond the model, messages and output budget. */
	readonly requestFields: (request: DiagramGenerationRequest) => Record<string, unknown>;
}

export const googleGatewayChatRoute: GatewayChatRoute = {
	apiPath: "v1beta/openai",
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
	apiPath: "v1",
	gatewayLabel: "Anthropic",
	gatewayProvider: "anthropic",
	modelId: stripAnthropicModelPrefix,
	modelLabel: "Claude",
	provider: "cloudflare-anthropic",
	// Haiku rejects `temperature` and a `json_object` format, and rejects our response schema
	// as `json_schema`: `diagram` is open and the IR is recursive. The prompt asks for JSON and
	// the parser is tolerant. Thinking on doubled tokens and latency without raising acceptance.
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

/** What the gateway answered, as it arrived. */
interface GatewayReply {
	body?: string;
	logId?: string;
	status?: number;
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
	const transport = makeGatewayHttpClient({
		gateway,
		provider: route.gatewayProvider,
		collectLog: config.collectLog,
		// AI Gateway keeps five metadata entries per request and drops the rest.
		metadata: {
			scenarioId: request.prompt.id,
			sketchiProvider: route.provider,
			sketchiSurface: config.surface,
			...(traceId ? { sketchiTraceId: traceId } : {}),
		},
		// A body that breaks is a retryable transport failure, not an unreadable answer.
		responseBody: "buffer",
		onResponse: (response) => {
			reply.status = response.status;
			const logId = response.headers.get("cf-aig-log-id");
			if (logId) reply.logId = logId;
		},
	}).pipe(
		HttpClient.tap((response) =>
			Effect.map(response.text, (body) => {
				reply.body = body;
			}),
		),
	);
	const client = yield* OpenAiClient.make({ apiUrl: `${GATEWAY_API_URL}/${route.apiPath}` }).pipe(
		Effect.provideService(HttpClient.HttpClient, transport),
	);
	const model = yield* OpenAiLanguageModel.make({
		model: modelId,
		config: { max_output_tokens: maxOutputTokens, ...requestFields },
	}).pipe(Effect.provideService(OpenAiClient.OpenAiClient, client));
	const response = yield* LanguageModel.generateText({
		prompt: Prompt.make([
			{ role: "system", content: system },
			{ role: "user", content: [{ type: "text", text: user }] },
		]),
	}).pipe(
		Effect.provideService(LanguageModel.LanguageModel, model),
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

export const CloudflareGatewayChatClientLive = Layer.effect(DiagramGenerationClient)(
	Effect.gen(function* () {
		const ai = yield* CloudflareAiGatewayBinding;
		const config = yield* CloudflareGatewayChatConfig;
		const policy = yield* DiagramGenerationPolicy;
		// Without it, an untyped request is routed by its words alone.
		const narrowing = Option.getOrUndefined(yield* Effect.serviceOption(DiagramFamilyNarrowing));
		const { provider } = config.route;
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
						Result.isSuccess(gateway)
							? runChatAttempt(gateway.success, config, attemptRequest)
							: Effect.fail(gateway.failure),
					request,
					provider,
					policy,
					narrowing,
				);
			}),
		};
	}),
);
