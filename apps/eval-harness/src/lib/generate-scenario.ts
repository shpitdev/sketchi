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
	errorMessage,
	generationErrorToCandidate,
	summarizeGenerationCandidate,
} from "@sketchi/diagram-generation";
import { getGenerationScenario, toDiagramGenerationPrompt } from "@sketchi/diagram-scenarios";
import { makeWorkersTelemetryLayer, withTelemetryCorrelation } from "@sketchi/observability";
import { createServerFn } from "@tanstack/react-start";
import { Context, Effect, Layer, ManagedRuntime, Schema, SchemaIssue } from "effect";
import { getRequest } from "@tanstack/react-start/server";

const DEFAULT_GATEWAY_ID = "google-ai-studio";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";
const DEFAULT_PROVIDERS: readonly DiagramGenerationProviderId[] = ["cloudflare-google-ai-studio"];
export const GenerateScenarioInputSchema = Schema.Struct({
	cacheMode: Schema.Literals(["default", "fresh"]).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("default" as const)),
	),
	providers: Schema.Array(DiagramGenerationProviderIdSchema).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_PROVIDERS)),
	),
	scenarioId: Schema.String.check(Schema.isMinLength(1)),
});

export class GenerateScenarioInputValidationError extends Schema.TaggedError<GenerateScenarioInputValidationError>()(
	"GenerateScenarioInputValidationError",
	{
		cause: Schema.Defect(),
		issues: Schema.Array(
			Schema.Struct({
				message: Schema.String,
				path: Schema.optional(
					Schema.Array(
						Schema.Union([Schema.PropertyKey, Schema.Struct({ key: Schema.PropertyKey })]),
					),
				),
			}),
		),
		message: Schema.String,
	},
) {}

export interface EvalHarnessEnv {
	AI?: CloudflareAiGatewayProvider;
	SKETCHI_AI_GATEWAY_ID?: string;
	SKETCHI_AI_MODEL?: string;
}

function envString(bindings: EvalHarnessEnv, key: keyof EvalHarnessEnv, fallback: string): string {
	const value = bindings[key];

	return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

export function decodeGenerateScenarioInput(input: unknown) {
	return Schema.decodeUnknownEffect(GenerateScenarioInputSchema, {
		errors: "all",
	})(input).pipe(
		Effect.mapError((cause) => {
			const { issues } = SchemaIssue.makeFormatterStandardSchemaV1()(cause.issue);
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
		error: error instanceof Error ? error.message : "Scenario generation failed.",
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

const runClient = Effect.fn("evalHarness.generateScenario.runClient")(function* (
	client: Context.Service.Shape<typeof DiagramGenerationClient>,
	cacheMode: DiagramGenerationCacheMode,
	model: string,
	scenarioId: string,
) {
	const requestSettings = { cacheMode, model };

	return yield* Effect.gen(function* () {
		const scenario = yield* Effect.try({
			try: () => getGenerationScenario(scenarioId),
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
				summarizeGenerationCandidate(generationErrorToCandidate(error, requestSettings)),
			onSuccess: summarizeGenerationCandidate,
		}),
	);
});

const generateScenarioCandidatesEffect = Effect.fn("evalHarness.generateScenarioCandidates")(
	function* (data: typeof GenerateScenarioInputSchema.Type, model = DEFAULT_MODEL) {
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
			(configuredClient) => runClient(configuredClient, data.cacheMode, model, data.scenarioId),
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
	},
);

export function generateScenarioCandidatesForInput(
	data: typeof GenerateScenarioInputSchema.Type,
	model = DEFAULT_MODEL,
) {
	return withTelemetryCorrelation(generateScenarioCandidatesEffect(data, model), {
		scenarioId: data.scenarioId,
	});
}

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

	const clientLayer = CloudflareGoogleAiStudioClientLive.pipe(Layer.provide(dependencies));

	return Layer.mergeAll(clientLayer, DiagramGenerationPolicyLive);
}

function makeGenerationRuntime(bindings: EvalHarnessEnv) {
	const gatewayId = envString(bindings, "SKETCHI_AI_GATEWAY_ID", DEFAULT_GATEWAY_ID);
	const model = envString(bindings, "SKETCHI_AI_MODEL", DEFAULT_MODEL);
	const telemetryLayer = makeWorkersTelemetryLayer({
		resource: { serviceName: "sketchi-eval-harness" },
	});
	return {
		model,
		runtime: ManagedRuntime.make(
			Layer.merge(generationClientLayer(bindings, gatewayId), telemetryLayer),
		),
	};
}

const generationRuntimes = new WeakMap<EvalHarnessEnv, ReturnType<typeof makeGenerationRuntime>>();

function generationRuntime(bindings: EvalHarnessEnv) {
	const cached = generationRuntimes.get(bindings);
	if (cached) return cached;
	const runtime = makeGenerationRuntime(bindings);
	generationRuntimes.set(bindings, runtime);
	return runtime;
}

export function runGenerateScenarioCandidatesForInput(
	input: unknown,
	bindings: EvalHarnessEnv,
	signal?: AbortSignal,
): Promise<DiagramGenerationScenarioOutput> {
	const { model, runtime } = generationRuntime(bindings);
	return runtime.runPromise(
		decodeGenerateScenarioInput(input).pipe(
			Effect.flatMap((data) => generateScenarioCandidatesForInput(data, model)),
		),
		signal ? { signal } : undefined,
	);
}

export const generateScenarioCandidates = createServerFn({ method: "POST" })
	.validator((input: unknown) => Effect.runSync(decodeGenerateScenarioInput(input)))
	.handler(async ({ data }) => {
		const { getEvalHarnessBindings } = await import("./cloudflare-bindings.server");

		const { model, runtime } = generationRuntime(getEvalHarnessBindings());
		return runtime.runPromise(generateScenarioCandidatesForInput(data, model), {
			signal: getRequest().signal,
		});
	});
