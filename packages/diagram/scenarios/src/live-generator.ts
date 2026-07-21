import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type DiagramGenerationCandidateSummary,
  DiagramGenerationScenarioOutput,
} from "@sketchi/diagram-generation";
import { Effect, Schema } from "effect";

class LiveGeneratorError extends Schema.TaggedErrorClass<LiveGeneratorError>()(
  "LiveGeneratorError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
  },
) {}

function readStdin(): Effect.Effect<string> {
  return Effect.callback((resume) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };
    const onEnd = () => {
      resume(Effect.succeed(Buffer.concat(chunks).toString("utf8")));
    };
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.resume();

    return Effect.sync(() => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
    });
  });
}

function requiredEnv(name: string): Effect.Effect<string, LiveGeneratorError> {
  const value = process.env[name]?.trim();
  return value
    ? Effect.succeed(value)
    : Effect.fail(
        LiveGeneratorError.make({
          message: `Missing required environment variable ${name}.`,
        }),
      );
}

function endpointUrl(baseUrl: string): string {
  return new URL("/api/scenario-candidates", baseUrl).toString();
}

function optionalPositiveInt(name: string, fallback: number): number {
  const value = process.env[name];
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function responseFileStem(scenarioId: string): string {
  const repeat = optionalPositiveInt("SKETCHI_SCENARIO_REPEAT", 1);
  const runNumber = optionalPositiveInt("SKETCHI_SCENARIO_RUN_NUMBER", 1);
  return repeat > 1
    ? `${scenarioId}.run-${String(runNumber).padStart(3, "0")}`
    : scenarioId;
}

function pickCandidate(
  candidates: readonly DiagramGenerationCandidateSummary[],
): DiagramGenerationCandidateSummary | undefined {
  return (
    candidates.find(
      (candidate) => candidate.diagramValid && !candidate.error,
    ) ?? candidates.find((candidate) => candidate.text.trim().length > 0)
  );
}

function writeResponseSidecar(response: DiagramGenerationScenarioOutput) {
  const resultDir = process.env.SKETCHI_LIVE_RESULT_DIR?.trim();
  if (!resultDir) return Effect.void;

  const outPath = path.join(
    resultDir,
    `${responseFileStem(response.scenarioId)}.response.json`,
  );
  const prepare = Effect.tryPromise({
    try: () => mkdir(path.dirname(outPath), { recursive: true }),
    catch: (cause) =>
      LiveGeneratorError.make({
        cause,
        message: `Unable to prepare generation response ${outPath}.`,
      }),
  });
  return prepare.pipe(
    Effect.andThen(
      Effect.tryPromise({
        try: () => writeFile(outPath, `${JSON.stringify(response, null, 2)}\n`),
        catch: (cause) =>
          LiveGeneratorError.make({
            cause,
            message: `Unable to write generation response ${outPath}.`,
          }),
      }),
    ),
  );
}

const main = Effect.gen(function* () {
  yield* readStdin();
  const scenarioId = yield* requiredEnv("SKETCHI_SCENARIO_ID");
  const playgroundUrl = yield* requiredEnv("SKETCHI_PLAYGROUND_URL");
  const cacheMode = process.env.SKETCHI_SCENARIO_CACHE_MODE ?? "fresh";
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(endpointUrl(playgroundUrl), {
        body: JSON.stringify({
          cacheMode,
          providers: ["cloudflare-google-ai-studio"],
          scenarioId,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal,
      }),
    catch: (cause) =>
      LiveGeneratorError.make({
        cause,
        message: "Unable to reach the eval harness Worker.",
      }),
  });
  const unknownData = yield* Effect.tryPromise({
    try: (_signal) => response.json(),
    catch: (cause) =>
      LiveGeneratorError.make({
        cause,
        message: "The eval harness returned an invalid JSON response.",
      }),
  });
  if (!response.ok) {
    const error =
      typeof unknownData === "object" &&
      unknownData !== null &&
      "error" in unknownData &&
      typeof unknownData.error === "string"
        ? unknownData.error
        : `Scenario generation failed with HTTP ${response.status}.`;
    return yield* Effect.fail(LiveGeneratorError.make({ message: error }));
  }
  const generationOutput = yield* Schema.decodeUnknownEffect(
    DiagramGenerationScenarioOutput,
  )(unknownData).pipe(
    Effect.mapError((cause) =>
      LiveGeneratorError.make({
        cause,
        message: "The eval harness response did not match its schema.",
      }),
    ),
  );
  yield* writeResponseSidecar(generationOutput);
  const candidate = pickCandidate(generationOutput.candidates);
  if (!candidate) {
    return yield* Effect.fail(
      LiveGeneratorError.make({
        message: `No candidate text returned for ${scenarioId}.`,
      }),
    );
  }
  process.stdout.write(`${candidate.text.trim()}\n`);
});

Effect.runPromise(main).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
