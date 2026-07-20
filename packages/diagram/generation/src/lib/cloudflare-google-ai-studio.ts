import { Clock, Context, Effect, Layer, Metric, Schedule } from "effect";

import {
  candidateFromText,
  responseErrorDiagnostic,
  type DiagramGenerationCacheMode,
  type DiagramGenerationRequest,
} from "./candidates.js";
import { DiagramGenerationClient, DiagramGenerationPolicy } from "./client.js";
import {
  DiagramGenerationHttpError,
  DiagramGenerationResponseError,
  DiagramGenerationTimeoutError,
  DiagramGenerationTransportError,
  errorMessage,
  isRetryableGenerationError,
} from "./errors.js";
import {
  buildGeminiGenerateContentBody,
  extractGeminiText,
  extractGeminiUsage,
  stripCloudflareGoogleModelPrefix,
} from "./gemini.js";

export interface CloudflareAiGateway {
  run(
    data: {
      endpoint: string;
      headers: Record<string, string>;
      provider: string;
      query: unknown;
    },
    options?: {
      gateway?: {
        collectLog?: boolean;
        metadata?: Record<string, number | string | boolean | null | bigint>;
      };
      signal?: AbortSignal;
    },
  ): Promise<Response>;
  getUrl(provider?: string): Promise<string>;
}

export interface CloudflareAiGatewayProvider {
  gateway(gatewayId: string): CloudflareAiGateway;
}

export class CloudflareAiGatewayBinding extends Context.Service<
  CloudflareAiGatewayBinding,
  CloudflareAiGatewayProvider
>()("@sketchi/diagram-generation/CloudflareAiGatewayBinding") {}

export interface CloudflareGoogleAiStudioConfigValue {
  readonly collectLog: boolean;
  readonly gatewayId: string;
}

export class CloudflareGoogleAiStudioConfig extends Context.Service<
  CloudflareGoogleAiStudioConfig,
  CloudflareGoogleAiStudioConfigValue
>()("@sketchi/diagram-generation/CloudflareGoogleAiStudioConfig") {}

function cacheModeHeaders(
  cacheMode: DiagramGenerationCacheMode | undefined,
): Record<string, string> {
  return cacheMode === "fresh"
    ? {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      }
    : {};
}

function parseJsonResponse(text: string): unknown {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

const generationAttempts = Metric.counter("sketchi_generation_attempts", {
  description: "Diagram generation upstream attempts",
  incremental: true,
}).pipe(Metric.withConstantInput(1));

const readResponse = Effect.fn("diagramGeneration.readResponse")(function* (
  response: Response,
) {
  const text = yield* Effect.tryPromise({
    try: (signal) =>
      response.text().then((body) => {
        if (signal.aborted) throw signal.reason;
        return body;
      }),
    catch: (cause) =>
      DiagramGenerationTransportError.make({
        cause,
        message: errorMessage(cause, "Generation response could not be read."),
        operation: "response.text",
        provider: "cloudflare-google-ai-studio",
        retryable: true,
      }),
  });

  return parseJsonResponse(text);
});

const runGatewayAttempt = Effect.fn(
  "diagramGeneration.cloudflareGoogleAiStudio.attempt",
)(function* (
  gateway: CloudflareAiGateway,
  collectLog: boolean,
  request: DiagramGenerationRequest,
) {
  const startedAt = yield* Clock.currentTimeMillis;
  const model = stripCloudflareGoogleModelPrefix(request.model);
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      gateway.run(
        {
          endpoint: `v1beta/models/${model}:generateContent`,
          provider: "google-ai-studio",
          headers: {
            "Content-Type": "application/json",
            ...cacheModeHeaders(request.cacheMode),
          },
          query: buildGeminiGenerateContentBody(request),
        },
        {
          gateway: {
            collectLog,
            metadata: {
              cacheMode: request.cacheMode ?? "default",
              scenarioId: request.prompt.id,
              sketchiProvider: "cloudflare-google-ai-studio",
            },
          },
          signal,
        },
      ),
    catch: (cause) =>
      DiagramGenerationTransportError.make({
        cause,
        message: errorMessage(cause, "Generation request failed."),
        operation: "gateway.run",
        provider: "cloudflare-google-ai-studio",
        retryable: true,
      }),
  }).pipe(Effect.track(generationAttempts));
  const raw = yield* readResponse(response);

  if (!response.ok) {
    const diagnostic = responseErrorDiagnostic(raw);
    const finishedAt = yield* Clock.currentTimeMillis;
    return yield* Effect.fail(
      DiagramGenerationHttpError.make({
        diagnostics: [
          `Google AI Studio Gateway request failed with HTTP ${response.status}.`,
          ...(diagnostic ? [diagnostic] : []),
        ],
        durationMs: Math.round(finishedAt - startedAt),
        provider: "cloudflare-google-ai-studio",
        raw,
        retryable: isTransientHttpStatus(response.status),
        status: response.status,
      }),
    );
  }

  const text = yield* Effect.try({
    try: () => extractGeminiText(raw),
    catch: (cause) =>
      DiagramGenerationResponseError.make({
        cause,
        message: errorMessage(
          cause,
          "Gemini response did not include text content.",
        ),
        provider: "cloudflare-google-ai-studio",
      }),
  });
  const usage = extractGeminiUsage(raw);

  return candidateFromText({
    model,
    provider: "cloudflare-google-ai-studio",
    raw,
    text,
    cacheMode: request.cacheMode ?? "default",
    ...(usage ? { usage } : {}),
  });
});

export const CloudflareGoogleAiStudioClientLive = Layer.effect(
  DiagramGenerationClient,
)(
  Effect.gen(function* () {
    const ai = yield* CloudflareAiGatewayBinding;
    const config = yield* CloudflareGoogleAiStudioConfig;
    const policy = yield* DiagramGenerationPolicy;

    return {
      provider: "cloudflare-google-ai-studio",
      generate: Effect.fn("diagramGeneration.generate")(function* (
        request: DiagramGenerationRequest,
      ) {
        yield* Effect.annotateCurrentSpan({
          cacheMode: request.cacheMode ?? "default",
          model: request.model,
          provider: "cloudflare-google-ai-studio",
          scenarioId: request.prompt.id,
        });
        const startedAt = yield* Clock.currentTimeMillis;
        const gateway = yield* Effect.try({
          try: () => ai.gateway(config.gatewayId),
          catch: (cause) =>
            DiagramGenerationTransportError.make({
              cause,
              message: errorMessage(
                cause,
                "AI Gateway could not be initialized.",
              ),
              operation: "ai.gateway",
              provider: "cloudflare-google-ai-studio",
              retryable: false,
            }),
        });
        const candidate = yield* runGatewayAttempt(
          gateway,
          config.collectLog,
          request,
        ).pipe(
          Effect.timeoutOrElse({
            duration: policy.requestTimeoutMs,
            orElse: () =>
              Effect.fail(
                DiagramGenerationTimeoutError.make({
                  message: `Generation timed out after ${policy.requestTimeoutMs} ms.`,
                  provider: "cloudflare-google-ai-studio",
                  timeoutMs: policy.requestTimeoutMs,
                }),
              ),
          }),
          Effect.tapError((error) =>
            isRetryableGenerationError(error)
              ? Effect.logWarning("Diagram generation attempt failed", {
                  errorTag: error._tag,
                  provider: "cloudflare-google-ai-studio",
                  scenarioId: request.prompt.id,
                })
              : Effect.void,
          ),
          Effect.retry({
            schedule: Schedule.exponential(policy.retryDelayMs),
            times: policy.maxRetries,
            while: isRetryableGenerationError,
          }),
        );
        const finishedAt = yield* Clock.currentTimeMillis;

        return {
          ...candidate,
          durationMs: Math.round(finishedAt - startedAt),
        };
      }),
    };
  }),
);
