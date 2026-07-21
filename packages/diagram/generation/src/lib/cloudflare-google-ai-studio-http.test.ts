import { assert, describe, it, vi } from "@effect/vitest";
import {
  makeTelemetryTestSink,
  makeWorkersTelemetryLayer,
  type TelemetryMetricEvent,
} from "@sketchi/observability";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import { DiagramGenerationClient, DiagramGenerationPolicy } from "./client.js";
import {
  CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC,
  CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC,
  CloudflareGoogleAiStudioHttpClientLive,
  CloudflareGoogleAiStudioHttpConfig,
  CloudflareGoogleAiStudioHttpFetch,
} from "./cloudflare-google-ai-studio-http.js";
import type { DiagramGenerationPrompt } from "./messages.js";

const prompt: DiagramGenerationPrompt = {
  id: "gateway-http-provider-test",
  request: "Create a start-to-finish release flow.",
  requiredBranchLabels: [],
  requiredNodeLabels: [],
  title: "Release flow",
  type: "flowchart",
};

const diagram = {
  id: "gateway-http-release-flow",
  title: "Release flow",
  type: "flowchart",
  nodes: [
    { id: "start", label: "Start release", kind: "start" },
    { id: "end", label: "Finish release", kind: "end" },
  ],
  edges: [{ id: "start-end", source: "start", target: "end" }],
  layout: { direction: "TB", edgeRouting: "orthogonal" },
  style: { accentColor: "#0f766e", backgroundColor: "#ffffff" },
};

function googleResponse(text = JSON.stringify(diagram)): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { role: "model", parts: [{ text }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        candidatesTokenCount: 13,
        promptTokenCount: 17,
        totalTokenCount: 30,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const policy = {
  concurrency: 1,
  maxRetries: 2,
  requestTimeoutMs: 1_000,
  retryDelayMs: 100,
};

function gatewayHttpClientLayer(
  fetch: typeof globalThis.fetch,
  options: {
    readonly accountId?: string;
    readonly gatewayId?: string;
    readonly maxRetries?: number;
    readonly requestTimeoutMs?: number;
    readonly token?: string;
  } = {},
) {
  return CloudflareGoogleAiStudioHttpClientLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(CloudflareGoogleAiStudioHttpConfig, {
          accountId: options.accountId ?? "test-account",
          gatewayId: options.gatewayId ?? "test-gateway",
          token: options.token,
        }),
        Layer.succeed(CloudflareGoogleAiStudioHttpFetch, { fetch }),
        Layer.succeed(DiagramGenerationPolicy, {
          ...policy,
          ...(options.maxRetries !== undefined
            ? { maxRetries: options.maxRetries }
            : {}),
          ...(options.requestTimeoutMs !== undefined
            ? { requestTimeoutMs: options.requestTimeoutMs }
            : {}),
        }),
      ),
    ),
  );
}

function request() {
  return {
    model: "google/gemini-3.1-flash-lite",
    prompt,
  };
}

describe("Cloudflare Google AI Studio HTTP DiagramGenerationClient layer", () => {
  it.effect(
    "routes the Google provider through authenticated Cloudflare AI Gateway BYOK",
    () => {
      const fetch = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          googleResponse(),
      );
      return Effect.gen(function* () {
        const client = yield* DiagramGenerationClient;
        const candidate = yield* client.generate(request());

        assert.strictEqual(client.provider, "cloudflare-google-ai-studio");
        assert.strictEqual(candidate.diagram?.id, diagram.id);
        assert.strictEqual(candidate.usage?.totalTokens, 30);
        assert.strictEqual(fetch.mock.calls.length, 1);
        const [url, init] = fetch.mock.calls[0] ?? [];
        assert.strictEqual(
          String(url),
          "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/google-ai-studio/v1beta/models/gemini-3.1-flash-lite:generateContent",
        );
        const headers = new Headers(init?.headers);
        assert.strictEqual(
          headers.get("cf-aig-authorization"),
          "Bearer test-gateway-token",
        );
        assert.strictEqual(headers.get("x-goog-api-key"), null);
        assert.strictEqual(headers.get("authorization"), null);
      }).pipe(
        Effect.provide(
          gatewayHttpClientLayer(fetch, { token: "test-gateway-token" }),
        ),
      );
    },
  );

  it.effect(
    "fails before fetch when the documented gateway token is missing",
    () => {
      const fetch = vi.fn(async () => googleResponse());
      const { probe, sink } = makeTelemetryTestSink();
      const telemetryLayer = makeWorkersTelemetryLayer({
        resource: { serviceName: "sketchi-gateway-http-preflight-test" },
        sink,
      });
      return Effect.gen(function* () {
        const client = yield* DiagramGenerationClient;
        const error = yield* Effect.flip(client.generate(request()));
        assert.strictEqual(error._tag, "DiagramGenerationConfigurationError");
        assert.strictEqual(fetch.mock.calls.length, 0);
        const metrics = probe.events.filter(
          (event): event is TelemetryMetricEvent =>
            event.event === "effect.metric",
        );
        assert.strictEqual(
          metrics.filter(
            (metric) => metric.metric === "sketchi_generation_attempts",
          ).length,
          0,
        );
        assert.strictEqual(
          metrics.filter(
            (metric) => metric.metric === "sketchi_generation_retries",
          ).length,
          0,
        );
        for (const metricName of [
          "sketchi_generation_requests",
          "sketchi_generation_failures",
          "sketchi_generation_duration_ms",
        ]) {
          const matching = metrics.filter(
            (metric) => metric.metric === metricName,
          );
          assert.strictEqual(matching.length, 1);
          assert.deepInclude(matching[0]?.attributes, {
            failure_category: "DiagramGenerationConfigurationError",
            operation: "generate",
            provider: "cloudflare-google-ai-studio",
          });
        }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(gatewayHttpClientLayer(fetch), telemetryLayer),
        ),
      );
    },
  );

  it.effect(
    "uses TestClock for timeout and aborts the provider request",
    () => {
      let providerSignal: AbortSignal | undefined;
      const fetch: typeof globalThis.fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          providerSignal = init?.signal ?? undefined;
          providerSignal?.addEventListener(
            "abort",
            () => reject(providerSignal?.reason),
            {
              once: true,
            },
          );
        });
      return Effect.gen(function* () {
        const client = yield* DiagramGenerationClient;
        const fiber = yield* Effect.forkChild(client.generate(request()));
        yield* Effect.yieldNow;
        yield* TestClock.adjust(100);
        const error = yield* Effect.flip(Fiber.join(fiber));

        assert.strictEqual(error._tag, "DiagramGenerationTimeoutError");
        assert.isTrue(providerSignal?.aborted === true);
      }).pipe(
        Effect.provide(
          gatewayHttpClientLayer(fetch, {
            maxRetries: 0,
            requestTimeoutMs: 100,
            token: "test-gateway-token",
          }),
        ),
      );
    },
  );

  it.effect(
    "retries transient provider failures with the shared policy",
    () => {
      let attempts = 0;
      const fetch = vi.fn(async () => {
        attempts += 1;
        return attempts < 3
          ? new Response('{"error":{"message":"temporarily unavailable"}}', {
              status: 503,
              headers: { "Content-Type": "application/json" },
            })
          : googleResponse();
      });
      return Effect.gen(function* () {
        const client = yield* DiagramGenerationClient;
        const fiber = yield* Effect.forkChild(client.generate(request()));
        yield* Effect.yieldNow;
        yield* TestClock.adjust(1_000);
        const candidate = yield* Fiber.join(fiber);

        assert.strictEqual(candidate.diagram?.id, diagram.id);
        assert.strictEqual(fetch.mock.calls.length, 3);
      }).pipe(
        Effect.provide(
          gatewayHttpClientLayer(fetch, { token: "test-gateway-token" }),
        ),
      );
    },
  );

  it.effect("does not retry permanent provider failures", () => {
    const fetch = vi.fn(
      async () =>
        new Response('{"error":{"message":"unknown model"}}', {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );
    return Effect.gen(function* () {
      const client = yield* DiagramGenerationClient;
      const error = yield* Effect.flip(client.generate(request()));

      assert.strictEqual(error._tag, "DiagramGenerationHttpError");
      if (error._tag === "DiagramGenerationHttpError") {
        assert.strictEqual(error.status, 400);
        assert.isFalse(error.retryable);
      }
      assert.strictEqual(fetch.mock.calls.length, 1);
    }).pipe(
      Effect.provide(
        gatewayHttpClientLayer(fetch, { token: "test-gateway-token" }),
      ),
    );
  });

  it.effect(
    "types rejected gateway authentication without leaking details",
    () => {
      const fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 401,
                message: "Unauthorized gateway token",
                status: "UNAUTHENTICATED",
              },
            }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
      );
      return Effect.gen(function* () {
        const client = yield* DiagramGenerationClient;
        const error = yield* Effect.flip(client.generate(request()));

        assert.strictEqual(error._tag, "DiagramGenerationHttpError");
        if (error._tag === "DiagramGenerationHttpError") {
          assert.strictEqual(error.status, 401);
          assert.deepStrictEqual(error.diagnostics, [
            "Cloudflare AI Gateway request failed with HTTP 401.",
            CLOUDFLARE_AI_GATEWAY_TOKEN_REJECTED_DIAGNOSTIC,
          ]);
      }
      assert.notInclude(JSON.stringify(error), "Unauthorized gateway token");
      assert.notInclude(JSON.stringify(error), "rejected-gateway-token");
      }).pipe(
        Effect.provide(
          gatewayHttpClientLayer(fetch, {
            maxRetries: 0,
            token: "rejected-gateway-token",
          }),
        ),
      );
    },
  );

  it.effect("types a missing stored Google provider key actionably", () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message:
                "No stored API key configured for provider google-ai-studio",
              status: "FAILED_PRECONDITION",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    );
    return Effect.gen(function* () {
      const client = yield* DiagramGenerationClient;
      const error = yield* Effect.flip(client.generate(request()));

      assert.strictEqual(error._tag, "DiagramGenerationHttpError");
      if (error._tag === "DiagramGenerationHttpError") {
        assert.strictEqual(error.status, 400);
        assert.deepStrictEqual(error.diagnostics, [
          "Cloudflare AI Gateway request failed with HTTP 400.",
          CLOUDFLARE_AI_GATEWAY_PROVIDER_KEY_DIAGNOSTIC,
        ]);
      }
      assert.notInclude(JSON.stringify(error), "No stored API key configured");
    }).pipe(
      Effect.provide(
        gatewayHttpClientLayer(fetch, {
          maxRetries: 0,
          token: "test-gateway-token",
        }),
      ),
    );
  });

  it.effect(
    "preserves malformed and semantically invalid output as candidates",
    () => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(googleResponse("not json"))
        .mockResolvedValueOnce(
          googleResponse(
            JSON.stringify({
              ...diagram,
              nodes: [{ id: "start", label: "Only start", kind: "start" }],
              edges: [],
            }),
          ),
        );
      return Effect.gen(function* () {
        const client = yield* DiagramGenerationClient;
        const malformed = yield* client.generate(request());
        const invalid = yield* client.generate(request());

        assert.isUndefined(malformed.diagram);
        assert.include(malformed.error ?? "", "JSON");
        assert.isUndefined(invalid.diagram);
        assert.isDefined(invalid.error);
      }).pipe(
        Effect.provide(
          gatewayHttpClientLayer(fetch, { token: "test-gateway-token" }),
        ),
      );
    },
  );

  it.effect(
    "propagates fiber interruption to the provider abort signal",
    () => {
      let providerSignal: AbortSignal | undefined;
      let markStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const fetch: typeof globalThis.fetch = (_input, init) =>
        new Promise((_resolve, reject) => {
          providerSignal = init?.signal ?? undefined;
          markStarted();
          providerSignal?.addEventListener(
            "abort",
            () => reject(providerSignal?.reason),
            {
              once: true,
            },
          );
        });
      return Effect.gen(function* () {
        const client = yield* DiagramGenerationClient;
        const fiber = yield* Effect.forkChild(client.generate(request()));
        yield* Effect.promise(() => started);
        yield* Fiber.interrupt(fiber);

        assert.isTrue(providerSignal?.aborted === true);
      }).pipe(
        Effect.provide(
          gatewayHttpClientLayer(fetch, {
            maxRetries: 0,
            token: "test-gateway-token",
          }),
        ),
      );
    },
  );
});
