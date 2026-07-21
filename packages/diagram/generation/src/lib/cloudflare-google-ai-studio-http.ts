import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  AISDKError,
  APICallError,
  InvalidResponseDataError,
  NoContentGeneratedError,
  NoOutputGeneratedError,
  generateText,
} from "ai";
import { Context, Effect, Layer } from "effect";

import {
  candidateFromText,
  type DiagramGenerationRequest,
  type DiagramGenerationUsage,
} from "./candidates.js";
import { DiagramGenerationClient, DiagramGenerationPolicy } from "./client.js";
import {
  DiagramGenerationConfigurationError,
  type DiagramGenerationError,
  DiagramGenerationHttpError,
  DiagramGenerationResponseError,
  DiagramGenerationTransportError,
  errorMessage,
} from "./errors.js";
import { stripGoogleModelPrefix } from "./gemini.js";
import { buildDiagramGenerationMessages } from "./messages.js";
import { runDiagramGenerationWithPolicy } from "./policy.js";

const CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER = "cloudflare-google-ai-studio";

export const CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC =
  "Cloudflare AI Gateway rejected the authentication token.";
export const CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC =
  "Cloudflare AI Gateway has no usable stored Google AI Studio provider key.";

const AI_SDK_BYOK_ADAPTER_KEY = "cloudflare-ai-gateway-byok";

export interface CloudflareGoogleAiStudioHttpConfigValue {
  readonly accountId: string;
  readonly gatewayId: string;
  readonly token: string | undefined;
}

export class CloudflareGoogleAiStudioHttpConfig extends Context.Service<
  CloudflareGoogleAiStudioHttpConfig,
  CloudflareGoogleAiStudioHttpConfigValue
>()("@sketchi/diagram-generation/CloudflareGoogleAiStudioHttpConfig") {}

export interface CloudflareGoogleAiStudioHttpFetchShape {
  readonly fetch: typeof globalThis.fetch;
}

export class CloudflareGoogleAiStudioHttpFetch extends Context.Service<
  CloudflareGoogleAiStudioHttpFetch,
  CloudflareGoogleAiStudioHttpFetchShape
>()("@sketchi/diagram-generation/CloudflareGoogleAiStudioHttpFetch") {}

function providerUsage(usage: {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly totalTokens: number | undefined;
}): DiagramGenerationUsage | undefined {
  const result: DiagramGenerationUsage = {};
  if (usage.inputTokens !== undefined) result.inputTokens = usage.inputTokens;
  if (usage.outputTokens !== undefined)
    result.outputTokens = usage.outputTokens;
  if (usage.totalTokens !== undefined) result.totalTokens = usage.totalTokens;
  return Object.keys(result).length > 0 ? result : undefined;
}

function responseIndicatesMissingProviderKey(cause: APICallError): boolean {
  const detail = `${cause.message}\n${cause.responseBody ?? ""}`.toLowerCase();
  const mentionsProviderCredential = [
    "api key",
    "byok",
    "credential",
    "provider key",
    "stored key",
  ].some((fragment) => detail.includes(fragment));
  const indicatesUnavailable = [
    "invalid",
    "missing",
    "no ",
    "not configured",
    "not found",
    "not valid",
    "unavailable",
  ].some((fragment) => detail.includes(fragment));
  return mentionsProviderCredential && indicatesUnavailable;
}

function gatewayProviderError(cause: unknown): DiagramGenerationError {
  if (APICallError.isInstance(cause) && cause.statusCode !== undefined) {
    const gatewayDiagnostic = responseIndicatesMissingProviderKey(cause)
      ? CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC
      : cause.statusCode === 401 || cause.statusCode === 403
        ? CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC
        : undefined;
    return DiagramGenerationHttpError.make({
      diagnostics: [
        `Cloudflare AI Gateway request failed with HTTP ${cause.statusCode}.`,
        ...(gatewayDiagnostic ? [gatewayDiagnostic] : []),
      ],
      durationMs: 0,
      provider: CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER,
      raw: {},
      retryable: cause.isRetryable,
      status: cause.statusCode,
    });
  }
  if (
    InvalidResponseDataError.isInstance(cause) ||
    NoContentGeneratedError.isInstance(cause) ||
    NoOutputGeneratedError.isInstance(cause) ||
    (AISDKError.isInstance(cause) && !APICallError.isInstance(cause))
  ) {
    return DiagramGenerationResponseError.make({
      cause,
      message:
        "Google AI Studio returned an unreadable response through Cloudflare AI Gateway.",
      provider: CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER,
    });
  }
  return DiagramGenerationTransportError.make({
    cause,
    message: errorMessage(cause, "Cloudflare AI Gateway request failed."),
    operation: "cloudflare.ai-gateway.generateText",
    provider: CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER,
    retryable: APICallError.isInstance(cause) ? cause.isRetryable : true,
  });
}

function gatewayBaseUrl(config: CloudflareGoogleAiStudioHttpConfigValue) {
  const accountId = encodeURIComponent(config.accountId);
  const gatewayId = encodeURIComponent(config.gatewayId);
  return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/google-ai-studio/v1beta`;
}

const prepareGatewayHttpAttempt = Effect.fn(
  "diagramGeneration.cloudflareGoogleAiStudioHttp.preflight",
)(function* (
  config: CloudflareGoogleAiStudioHttpConfigValue,
  fetchService: CloudflareGoogleAiStudioHttpFetchShape,
  request: DiagramGenerationRequest,
) {
  const token = config.token?.trim();
  if (!token) {
    return yield* DiagramGenerationConfigurationError.make({
      message:
        "Cloudflare AI Gateway generation requires an authentication token.",
      provider: CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER,
    });
  }

  const messages = buildDiagramGenerationMessages(request.prompt);
  const provider = createGoogleGenerativeAI({
    // The SDK requires an apiKey value before merging custom headers. The
    // inert value is removed below, so no Google credential is sent; AI
    // Gateway injects its stored BYOK provider key.
    apiKey: AI_SDK_BYOK_ADAPTER_KEY,
    baseURL: gatewayBaseUrl(config),
    fetch: fetchService.fetch,
    headers: {
      "cf-aig-authorization": `Bearer ${token}`,
      "x-goog-api-key": undefined,
    },
    name: "cloudflare.google-ai-studio",
  });
  const model = stripGoogleModelPrefix(request.model);
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        generateText({
          abortSignal: signal,
          maxRetries: 0,
          model: provider(model),
          prompt: messages.user,
          system: messages.system,
          ...(request.maxOutputTokens !== undefined
            ? { maxOutputTokens: request.maxOutputTokens }
            : {}),
          ...(request.temperature !== undefined
            ? { temperature: request.temperature }
            : {}),
        }),
      catch: gatewayProviderError,
    });

    if (!response.text.trim()) {
      return yield* DiagramGenerationResponseError.make({
        cause: new Error("Empty model response."),
        message:
          "Google AI Studio returned no text content through Cloudflare AI Gateway.",
        provider: CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER,
      });
    }

    const usage = providerUsage(response.usage);
    return candidateFromText({
      cacheMode: request.cacheMode ?? "default",
      model,
      provider: CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER,
      text: response.text,
      ...(usage ? { usage } : {}),
    });
  }).pipe(
    Effect.withSpan("diagramGeneration.cloudflareGoogleAiStudioHttp.attempt"),
  );
});

export const CloudflareGoogleAiStudioHttpClientLive = Layer.effect(
  DiagramGenerationClient,
  Effect.gen(function* () {
    const config = yield* CloudflareGoogleAiStudioHttpConfig;
    const fetchService = yield* CloudflareGoogleAiStudioHttpFetch;
    const policy = yield* DiagramGenerationPolicy;

    return {
      provider: CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER,
      generate: Effect.fn("diagramGeneration.generate")(function* (
        request: DiagramGenerationRequest,
      ) {
        yield* Effect.annotateCurrentSpan({
          cache_mode: request.cacheMode ?? "default",
          model: request.model,
          provider: CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER,
          "sketchi.scenario_id": request.prompt.id,
        });
        return yield* runDiagramGenerationWithPolicy(
          prepareGatewayHttpAttempt(config, fetchService, request),
          request,
          CLOUDFLARE_GOOGLE_AI_STUDIO_PROVIDER,
          policy,
        );
      }),
    };
  }),
);
