import { recordMetric, withTelemetryCorrelation } from "@sketchi/observability";
import {
  Clock,
  Context,
  Effect,
  Layer,
  Metric,
  Ref,
  Schedule,
  Schema,
} from "effect";

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

export class CloudflareGoogleAiStudioConfigValue extends Schema.Class<CloudflareGoogleAiStudioConfigValue>(
  "CloudflareGoogleAiStudioConfigValue",
)({
  collectLog: Schema.Boolean,
  gatewayId: Schema.String,
}) {}

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
});
const generationRequests = Metric.counter("sketchi_generation_requests", {
  description: "Diagram generation requests by terminal outcome",
  incremental: true,
});
const generationRetries = Metric.counter("sketchi_generation_retries", {
  description: "Diagram generation retry attempts",
  incremental: true,
});
const generationFailures = Metric.counter("sketchi_generation_failures", {
  description: "Diagram generation terminal failures",
  incremental: true,
});
const generationTimeouts = Metric.counter("sketchi_generation_timeouts", {
  description: "Diagram generation upstream timeouts",
  incremental: true,
});
const generationDuration = Metric.histogram("sketchi_generation_duration_ms", {
  description: "Diagram generation request duration in milliseconds",
  boundaries: Metric.boundariesFromIterable([
    50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000,
  ]),
});

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
  });
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
          cache_mode: request.cacheMode ?? "default",
          model: request.model,
          provider: "cloudflare-google-ai-studio",
          "sketchi.scenario_id": request.prompt.id,
        });
        const startedAt = yield* Clock.currentTimeMillis;
        const operation = Effect.gen(function* () {
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
          const attemptRef = yield* Ref.make(0);
          const previousErrorTagRef = yield* Ref.make("initial");
          const attempt = Effect.gen(function* () {
            const attemptNumber = yield* Ref.updateAndGet(
              attemptRef,
              (value) => value + 1,
            );
            yield* recordMetric(generationAttempts, 1, {
              operation: "generate",
              provider: "cloudflare-google-ai-studio",
            });
            if (attemptNumber > 1) {
              const previousErrorTag = yield* Ref.get(previousErrorTagRef);
              yield* recordMetric(generationRetries, 1, {
                operation: "generate",
                provider: "cloudflare-google-ai-studio",
                retryKind: "transient",
              });
              yield* Effect.logWarning("Retrying diagram generation", {
                attempt: attemptNumber,
                error_tag: previousErrorTag,
                operation: "generate",
                provider: "cloudflare-google-ai-studio",
                retry_kind: "transient",
              });
            }
            return yield* runGatewayAttempt(
              gateway,
              config.collectLog,
              request,
            ).pipe(
              Effect.annotateSpans({ attempt: attemptNumber }),
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
                Ref.set(previousErrorTagRef, error._tag),
              ),
            );
          });
          const candidate = yield* attempt.pipe(
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
        }).pipe(
          Effect.tap((candidate) =>
            Effect.all([
              recordMetric(generationRequests, 1, {
                operation: "generate",
                outcome: "success",
                provider: "cloudflare-google-ai-studio",
              }),
              recordMetric(generationDuration, candidate.durationMs, {
                operation: "generate",
                outcome: "success",
                provider: "cloudflare-google-ai-studio",
              }),
            ]),
          ),
          Effect.tapError((error) =>
            Effect.gen(function* () {
              const finishedAt = yield* Clock.currentTimeMillis;
              const durationMs = Math.max(0, finishedAt - startedAt);
              yield* recordMetric(generationRequests, 1, {
                failureCategory: error._tag,
                operation: "generate",
                outcome: "failure",
                provider: "cloudflare-google-ai-studio",
              });
              yield* recordMetric(generationFailures, 1, {
                failureCategory: error._tag,
                operation: "generate",
                provider: "cloudflare-google-ai-studio",
              });
              yield* recordMetric(generationDuration, durationMs, {
                failureCategory: error._tag,
                operation: "generate",
                outcome: "failure",
                provider: "cloudflare-google-ai-studio",
              });
              if (error._tag === "DiagramGenerationTimeoutError") {
                yield* recordMetric(generationTimeouts, 1, {
                  operation: "generate",
                  provider: "cloudflare-google-ai-studio",
                  timeoutKind: "upstream",
                });
              }
            }),
          ),
        );

        return yield* withTelemetryCorrelation(operation, {
          scenarioId: request.prompt.id,
        });
      }),
    };
  }),
);
