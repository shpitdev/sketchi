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
  type DiagramGenerationScenarioOutput,
  type DiagramGenerationProviderId,
  DiagramGenerationProviderIdSchema,
  DiagramGenerationPolicy,
  DiagramGenerationPolicyLive,
  diagramGenerationProviderIds,
  errorMessage,
  generationErrorToCandidate,
  summarizeGenerationCandidate,
} from "@sketchi/diagram-generation";
import {
  getScenario,
  toDiagramGenerationPrompt,
} from "@sketchi/diagram-scenarios";
import {
  makeWorkersTelemetryLayer,
  withTelemetryCorrelation,
} from "@sketchi/observability";
import { createServerFn } from "@tanstack/react-start";
import { Context, Effect, Layer, Schema } from "effect";

const DEFAULT_GATEWAY_ID = "google-ai-studio";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
const DEFAULT_PROVIDERS: readonly DiagramGenerationProviderId[] = [
  "cloudflare-google-ai-studio",
];
export const GenerateScenarioInputSchema = Schema.Struct({
  cacheMode: Schema.Literals(["default", "fresh"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("default" as const)),
  ),
  providers: Schema.Array(DiagramGenerationProviderIdSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_PROVIDERS)),
  ),
  scenarioId: Schema.String.check(Schema.isMinLength(1)),
});

export type GenerateScenarioInput = typeof GenerateScenarioInputSchema.Encoded;

export type GenerateScenarioOutput = DiagramGenerationScenarioOutput;

const GenerateScenarioIssuePathSegmentSchema = Schema.Union([
  Schema.String,
  Schema.Int,
]);

export class GenerateScenarioValidationIssue extends Schema.Class<GenerateScenarioValidationIssue>(
  "GenerateScenarioValidationIssue",
)({
  code: Schema.String,
  values: Schema.optional(Schema.Array(Schema.String).pipe(Schema.mutable)),
  path: Schema.Array(GenerateScenarioIssuePathSegmentSchema).pipe(
    Schema.mutable,
  ),
  message: Schema.String,
}) {}

export class GenerateScenarioInputValidationError extends Schema.TaggedErrorClass<GenerateScenarioInputValidationError>()(
  "GenerateScenarioInputValidationError",
  {
    cause: Schema.Defect(),
    issues: Schema.Array(GenerateScenarioValidationIssue).pipe(Schema.mutable),
    message: Schema.String,
  },
) {}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidValueMessage(values: readonly string[]): string {
  return `Invalid option: expected one of ${values.map((value) => JSON.stringify(value)).join("|")}`;
}

function generateScenarioValidationIssues(
  input: unknown,
): GenerateScenarioValidationIssue[] {
  if (!isRecord(input)) {
    return [
      new GenerateScenarioValidationIssue({
        code: "invalid_type",
        message: "Invalid input: expected object",
        path: [],
      }),
    ];
  }

  const issues: GenerateScenarioValidationIssue[] = [];
  if (
    input.cacheMode !== undefined &&
    input.cacheMode !== "default" &&
    input.cacheMode !== "fresh"
  ) {
    const values = ["default", "fresh"];
    issues.push(
      new GenerateScenarioValidationIssue({
        code: "invalid_value",
        message: invalidValueMessage(values),
        path: ["cacheMode"],
        values,
      }),
    );
  }

  if (input.providers !== undefined) {
    if (Array.isArray(input.providers)) {
      input.providers.forEach((provider, index) => {
        if (
          typeof provider !== "string" ||
          !diagramGenerationProviderIds.some(
            (candidate) => candidate === provider,
          )
        ) {
          const values = [...diagramGenerationProviderIds];
          issues.push(
            new GenerateScenarioValidationIssue({
              code: "invalid_value",
              message: invalidValueMessage(values),
              path: ["providers", index],
              values,
            }),
          );
        }
      });
    } else {
      issues.push(
        new GenerateScenarioValidationIssue({
          code: "invalid_type",
          message: "Invalid input: expected array",
          path: ["providers"],
        }),
      );
    }
  }

  if (typeof input.scenarioId !== "string") {
    issues.push(
      new GenerateScenarioValidationIssue({
        code: "invalid_type",
        message: "Invalid input: expected string",
        path: ["scenarioId"],
      }),
    );
  } else if (input.scenarioId.length < 1) {
    issues.push(
      new GenerateScenarioValidationIssue({
        code: "too_small",
        message: "Too small: expected string to have >=1 characters",
        path: ["scenarioId"],
      }),
    );
  }

  return issues.length > 0
    ? issues
    : [
        new GenerateScenarioValidationIssue({
          code: "invalid_input",
          message: "Invalid scenario generation input.",
          path: [],
        }),
      ];
}

export function decodeGenerateScenarioInput(input: unknown) {
  return Schema.decodeUnknownEffect(GenerateScenarioInputSchema)(input).pipe(
    Effect.mapError((cause) => {
      const issues = generateScenarioValidationIssues(input);
      return GenerateScenarioInputValidationError.make({
        cause,
        issues,
        message: JSON.stringify(issues, null, 2),
      });
    }),
  );
}

export function generateScenarioErrorPayload(error: unknown): {
  readonly error: string;
} {
  if (error instanceof GenerateScenarioInputValidationError) {
    return { error: error.message };
  }
  return {
    error:
      error instanceof Error ? error.message : "Scenario generation failed.",
  };
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
)(function* (input: unknown, model = DEFAULT_MODEL) {
  const client = yield* DiagramGenerationClient;
  const policy = yield* DiagramGenerationPolicy;
  const data = yield* decodeGenerateScenarioInput(input);
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
  input: unknown,
  bindings: EvalHarnessEnv,
): Promise<GenerateScenarioOutput> {
  const gatewayId = envString(
    bindings,
    "SKETCHI_AI_GATEWAY_ID",
    DEFAULT_GATEWAY_ID,
  );
  const model = envString(bindings, "SKETCHI_AI_MODEL", DEFAULT_MODEL);
  const telemetryLayer = makeWorkersTelemetryLayer({
    resource: { serviceName: "sketchi-eval-harness" },
  });

  return Effect.runPromise(
    withTelemetryCorrelation(generateScenarioCandidatesForInput(input, model), {
      scenarioId:
        isRecord(input) && typeof input.scenarioId === "string"
          ? input.scenarioId
          : "unknown",
    }).pipe(
      Effect.provide(
        Layer.merge(generationClientLayer(bindings, gatewayId), telemetryLayer),
      ),
    ),
  );
}

export const generateScenarioCandidates = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    Schema.decodeUnknownSync(GenerateScenarioInputSchema, { errors: "all" })(
      input,
    ),
  )
  .handler(async ({ data }) => {
    const { getEvalHarnessBindings } = await import(
      "./cloudflare-bindings.server"
    );

    return runGenerateScenarioCandidatesForInput(
      data,
      getEvalHarnessBindings(),
    );
  });
