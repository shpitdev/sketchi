import {
  CloudflareAiGatewayBinding,
  CloudflareGoogleAiStudioClientLive,
  CloudflareGoogleAiStudioConfig,
  type CloudflareAiGatewayProvider,
  DiagramGenerationClient,
  DiagramGenerationConfigurationError,
  DiagramGenerationInputError,
  type DiagramGenerationCacheMode,
  type DiagramGenerationCandidateSummary,
  type DiagramGenerationProviderId,
  DiagramGenerationProviderIdSchema,
  DiagramGenerationPolicy,
  DiagramGenerationPolicyLive,
  errorMessage,
  generationErrorToCandidate,
  summarizeGenerationCandidate,
} from "@sketchi/diagram-generation";
import {
  getScenario,
  toDiagramGenerationPrompt,
} from "@sketchi/diagram-scenarios";
import { createServerFn } from "@tanstack/react-start";
import { Context, Effect, Layer } from "effect";
import { z } from "zod";

const DEFAULT_GATEWAY_ID = "google-ai-studio";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
const DEFAULT_PROVIDERS: readonly DiagramGenerationProviderId[] = [
  "cloudflare-google-ai-studio",
];

const GenerateScenarioInputSchema = z.object({
  cacheMode: z.enum(["default", "fresh"]).default("default"),
  providers: z
    .array(DiagramGenerationProviderIdSchema)
    .default([...DEFAULT_PROVIDERS]),
  scenarioId: z.string().min(1),
});

export type GenerateScenarioInput = z.input<typeof GenerateScenarioInputSchema>;

export interface GenerateScenarioOutput {
  candidates: DiagramGenerationCandidateSummary[];
  model: string;
  scenarioId: string;
}

export interface EvalHarnessEnv {
  AI?: CloudflareAiGatewayProvider;
  SKETCHI_AI_GATEWAY_ID?: string;
  SKETCHI_AI_MODEL?: string;
}

function envString(
  bindings: EvalHarnessEnv,
  key: keyof EvalHarnessEnv,
  fallback: string,
): string {
  const value = bindings[key];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function errorCandidate(
  provider: DiagramGenerationProviderId,
  model: string,
  message: string,
  cacheMode: DiagramGenerationCacheMode = "default",
): DiagramGenerationCandidateSummary {
  return {
    cacheMode,
    diagnostics: [message],
    diagramValid: false,
    error: message,
    model,
    provider,
    text: "",
  };
}

const runClient = Effect.fn("evalHarness.generateScenario.runClient")(
  function* (
    client: Context.Service.Shape<typeof DiagramGenerationClient>,
    cacheMode: DiagramGenerationCacheMode,
    model: string,
    scenarioId: string,
  ) {
    const requestSettings = { cacheMode, model };

    return yield* Effect.gen(function* () {
      const scenario = yield* Effect.try({
        try: () => getScenario(scenarioId),
        catch: (cause) =>
          DiagramGenerationInputError.make({
            cause,
            message: errorMessage(cause, "Unknown generation scenario."),
            provider: client.provider,
            scenarioId,
          }),
      });

      return yield* client.generate({
        ...requestSettings,
        prompt: toDiagramGenerationPrompt(scenario),
      });
    }).pipe(
      Effect.match({
        onFailure: (error) =>
          summarizeGenerationCandidate(
            generationErrorToCandidate(error, requestSettings),
          ),
        onSuccess: summarizeGenerationCandidate,
      }),
    );
  },
);

export const generateScenarioCandidatesForInput = Effect.fn(
  "evalHarness.generateScenarioCandidates",
)(function* (input: GenerateScenarioInput, model = DEFAULT_MODEL) {
  const data = GenerateScenarioInputSchema.parse(input);
  const client = yield* DiagramGenerationClient;
  const policy = yield* DiagramGenerationPolicy;
  yield* Effect.annotateCurrentSpan({
    cacheMode: data.cacheMode,
    model,
    providerCount: data.providers.length,
    scenarioId: data.scenarioId,
  });
  const configuredClients = data.providers
    .filter((provider) => provider === client.provider)
    .map(() => client);
  const clientProviders = new Set(
    configuredClients.map((configuredClient) => configuredClient.provider),
  );
  const candidates = yield* Effect.forEach(
    configuredClients,
    (configuredClient) =>
      runClient(configuredClient, data.cacheMode, model, data.scenarioId),
    { concurrency: policy.concurrency },
  );
  const missingCandidates = data.providers
    .filter((provider) => !clientProviders.has(provider))
    .map((provider) =>
      errorCandidate(
        provider,
        model,
        `Provider "${provider}" is not configured in this Worker environment.`,
        data.cacheMode,
      ),
    );

  return {
    candidates: [...candidates, ...missingCandidates],
    model,
    scenarioId: data.scenarioId,
  };
});

function generationClientLayer(bindings: EvalHarnessEnv, gatewayId: string) {
  if (!bindings.AI) {
    return Layer.mergeAll(
      Layer.succeed(DiagramGenerationClient, {
        provider: "cloudflare-google-ai-studio",
        generate: Effect.fn("diagramGeneration.unavailable")(function* () {
          return yield* Effect.fail(
            DiagramGenerationConfigurationError.make({
              message:
                'Provider "cloudflare-google-ai-studio" is not configured in this Worker environment.',
              provider: "cloudflare-google-ai-studio",
            }),
          );
        }),
      }),
      DiagramGenerationPolicyLive,
    );
  }

  const dependencies = Layer.mergeAll(
    Layer.succeed(CloudflareAiGatewayBinding, bindings.AI),
    Layer.succeed(CloudflareGoogleAiStudioConfig, {
      collectLog: true,
      gatewayId,
    }),
    DiagramGenerationPolicyLive,
  );

  const clientLayer = CloudflareGoogleAiStudioClientLive.pipe(
    Layer.provide(dependencies),
  );

  return Layer.mergeAll(clientLayer, DiagramGenerationPolicyLive);
}

export function runGenerateScenarioCandidatesForInput(
  input: GenerateScenarioInput,
  bindings: EvalHarnessEnv,
): Promise<GenerateScenarioOutput> {
  const gatewayId = envString(
    bindings,
    "SKETCHI_AI_GATEWAY_ID",
    DEFAULT_GATEWAY_ID,
  );
  const model = envString(bindings, "SKETCHI_AI_MODEL", DEFAULT_MODEL);

  return Effect.runPromise(
    generateScenarioCandidatesForInput(input, model).pipe(
      Effect.provide(generationClientLayer(bindings, gatewayId)),
    ),
  );
}

export const generateScenarioCandidates = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => GenerateScenarioInputSchema.parse(input))
  .handler(async ({ data }) => {
    const { getEvalHarnessBindings } = await import(
      "./cloudflare-bindings.server"
    );

    return runGenerateScenarioCandidatesForInput(
      data,
      getEvalHarnessBindings(),
    );
  });
