import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { NodeRuntime } from "@effect/platform-node";
import { Effect, Schema } from "effect";

import {
  parseCliOptions,
  resolveGeneratorCommand,
  usage,
} from "./lib/cli-options.js";
import {
  evaluateScenarioDiagram,
  evaluateScenarioFixture,
  evaluateScenarioOutput,
} from "./lib/evaluate.js";
import { buildScenarioPrompt } from "./lib/prompt.js";
import {
  type DiagramScenario,
  flowchartScenarios,
  getScenario,
} from "./lib/scenarios.js";
import {
  requireSuccessfulToolProcess,
  runToolProcess,
  ToolProcessControlError,
  ToolProcessExitError,
  ToolProcessPolicyError,
  ToolProcessSpawner,
  ToolProcessSpawnerLive,
  ToolProcessSpawnError,
} from "./internal/tool-process.js";

class ScenarioToolError extends Schema.TaggedErrorClass<ScenarioToolError>()(
  "ScenarioToolError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
  },
) {}

export class ScenarioCliUsageError extends Schema.TaggedErrorClass<ScenarioCliUsageError>()(
  "ScenarioCliUsageError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
  },
) {}

const processPolicy = {
  closeGraceMs: 1_000,
  forceSettleGraceMs: 1_000,
  hardKillGraceMs: 2_000,
  timeoutMs: 120_000,
} as const;

function scenarioToolError(
  message: string,
  cause?: unknown,
): ScenarioToolError {
  return ScenarioToolError.make({ cause, message });
}

function scenarioUsageError(
  message: string,
  cause?: unknown,
): ScenarioCliUsageError {
  return ScenarioCliUsageError.make({ cause, message });
}

function parseScenarioOptions(argv: readonly string[]) {
  return Effect.try({
    try: () => parseCliOptions(argv),
    catch: (cause) =>
      scenarioUsageError(
        cause instanceof Error ? cause.message : "Unable to parse options.",
        cause,
      ),
  });
}

function selectScenarios(
  all: boolean,
  scenarioId: string | undefined,
): Effect.Effect<readonly DiagramScenario[], ScenarioCliUsageError> {
  if (all) return Effect.succeed(flowchartScenarios);
  return Effect.try({
    try: () => [getScenario(scenarioId ?? "")],
    catch: (cause) =>
      scenarioUsageError(
        cause instanceof Error ? cause.message : "Unknown scenario.",
        cause,
      ),
  });
}

function resolveScenarioGeneratorCommand(
  options: Parameters<typeof resolveGeneratorCommand>[0],
): Effect.Effect<string | undefined, ScenarioCliUsageError> {
  return Effect.try({
    try: () => resolveGeneratorCommand(options),
    catch: (cause) =>
      scenarioUsageError(
        cause instanceof Error
          ? cause.message
          : "Unable to resolve the generator command.",
        cause,
      ),
  });
}

function runCommand(
  command: string,
  scenario: DiagramScenario,
  stdin: string,
  run: { readonly repeat: number; readonly runIndex: number },
) {
  const spec = {
    args: [],
    command,
    env: {
      ...process.env,
      SKETCHI_SCENARIO_DIFFICULTY: scenario.difficulty,
      SKETCHI_SCENARIO_ID: scenario.id,
      SKETCHI_SCENARIO_REPEAT: String(run.repeat),
      SKETCHI_SCENARIO_RUN_INDEX: String(run.runIndex),
      SKETCHI_SCENARIO_RUN_NUMBER: String(run.runIndex + 1),
      SKETCHI_SCENARIO_TITLE: scenario.title,
    },
    shell: true,
    stdin,
  } as const;

  return runToolProcess(spec, processPolicy).pipe(
    Effect.flatMap((result) => requireSuccessfulToolProcess(spec, result)),
  );
}

function writeJson(filePath: string, value: unknown) {
  const prepare = Effect.tryPromise({
    try: () => mkdir(path.dirname(filePath), { recursive: true }),
    catch: (cause) =>
      scenarioToolError(`Unable to prepare JSON file ${filePath}.`, cause),
  });
  return prepare.pipe(
    Effect.andThen(
      Effect.tryPromise({
        try: () => writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`),
        catch: (cause) =>
          scenarioToolError(`Unable to write JSON file ${filePath}.`, cause),
      }),
    ),
  );
}

function writeText(filePath: string, value: string) {
  const prepare = Effect.tryPromise({
    try: () => mkdir(path.dirname(filePath), { recursive: true }),
    catch: (cause) =>
      scenarioToolError(`Unable to prepare text file ${filePath}.`, cause),
  });
  return prepare.pipe(
    Effect.andThen(
      Effect.tryPromise({
        try: () => writeFile(filePath, value),
        catch: (cause) =>
          scenarioToolError(`Unable to write text file ${filePath}.`, cause),
      }),
    ),
  );
}

function readText(filePath: string) {
  return Effect.tryPromise({
    try: () => readFile(filePath, "utf8"),
    catch: (cause) =>
      scenarioToolError(`Unable to read input file ${filePath}.`, cause),
  });
}

function parseCandidate(candidateOutput: string) {
  return Effect.try({
    try: () => JSON.parse(candidateOutput) as unknown,
    catch: (cause) => scenarioToolError("Candidate output is not JSON.", cause),
  });
}

function outputPathForScenario(input: {
  readonly out: string | undefined;
  readonly outDir: string | undefined;
  readonly repeat: number;
  readonly runIndex: number;
  readonly scenarioId: string;
}): string | undefined {
  if (input.outDir) {
    return path.join(
      input.outDir,
      `${scenarioRunFileStem(input.scenarioId, input.runIndex, input.repeat)}.excalidraw`,
    );
  }
  return input.out;
}

function candidatePathForScenario(input: {
  readonly candidateOutDir: string | undefined;
  readonly repeat: number;
  readonly runIndex: number;
  readonly scenarioId: string;
}): string | undefined {
  return input.candidateOutDir
    ? path.join(
        input.candidateOutDir,
        `${scenarioRunFileStem(input.scenarioId, input.runIndex, input.repeat)}.candidate.txt`,
      )
    : undefined;
}

function scenarioRunFileStem(
  scenarioId: string,
  runIndex: number,
  repeat: number,
): string {
  return repeat > 1
    ? `${scenarioId}.run-${String(runIndex + 1).padStart(3, "0")}`
    : scenarioId;
}

function evaluateScenario(
  scenario: DiagramScenario,
  input: {
    readonly generatorCommand: string | undefined;
    readonly input: string | undefined;
    readonly repeat: number;
    readonly runIndex: number;
    readonly useFixture: boolean;
  },
): Effect.Effect<
  {
    readonly candidateOutput: string;
    readonly evaluation: ReturnType<typeof evaluateScenarioFixture>;
  },
  | ScenarioToolError
  | ToolProcessControlError
  | ToolProcessExitError
  | ToolProcessPolicyError
  | ToolProcessSpawnError,
  ToolProcessSpawner
> {
  if (input.useFixture) {
    const candidateOutput = JSON.stringify(scenario.expectedDiagram, null, 2);
    return Effect.succeed({
      candidateOutput,
      evaluation: evaluateScenarioFixture(scenario),
    });
  }

  if (input.input) {
    return readText(input.input).pipe(
      Effect.flatMap((candidateOutput) =>
        parseCandidate(candidateOutput).pipe(
          Effect.map((candidate) => ({
            candidateOutput,
            evaluation: evaluateScenarioDiagram(scenario, candidate),
          })),
        ),
      ),
    );
  }

  if (input.generatorCommand) {
    return runCommand(
      input.generatorCommand,
      scenario,
      buildScenarioPrompt(scenario),
      { repeat: input.repeat, runIndex: input.runIndex },
    ).pipe(
      Effect.map((candidateOutput) => ({
        candidateOutput,
        evaluation: evaluateScenarioOutput(scenario, candidateOutput),
      })),
    );
  }

  return Effect.fail(
    scenarioToolError(
      `Choose --fixture, --input, or --generator-command.\n\n${usage()}`,
    ),
  );
}

export const runScenarioCli = Effect.fn("diagramScenarios.cli")(function* (
  argv: readonly string[],
) {
  const options = yield* parseScenarioOptions(argv);

  if (options.list) {
    console.log(
      JSON.stringify(
        flowchartScenarios.map((scenario) => ({
          id: scenario.id,
          title: scenario.title,
          description: scenario.description,
          difficulty: scenario.difficulty,
          tags: scenario.tags,
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (options.all && options.input) {
    return yield* Effect.fail(
      scenarioUsageError("--input can only be used with one --scenario."),
    );
  }
  if (options.all && options.out) {
    return yield* Effect.fail(
      scenarioUsageError(
        "--out can only be used with one --scenario. Use --out-dir for --all.",
      ),
    );
  }
  if (options.repeat > 1 && options.out) {
    return yield* Effect.fail(
      scenarioUsageError(
        "--out can only be used with --repeat 1. Use --out-dir.",
      ),
    );
  }
  if (!options.all && !options.scenarioId) {
    return yield* Effect.fail(
      scenarioUsageError(`Missing --scenario.\n\n${usage()}`),
    );
  }

  const scenarios = yield* selectScenarios(options.all, options.scenarioId);
  const generatorCommand = yield* resolveScenarioGeneratorCommand(options);
  if (!options.useFixture && !options.input && !generatorCommand) {
    return yield* Effect.fail(
      scenarioUsageError(
        `Choose --fixture, --input, or --generator-command.\n\n${usage()}`,
      ),
    );
  }

  const runs = Array.from({ length: options.repeat }, (_, runIndex) =>
    scenarios.map((scenario) => ({ runIndex, scenario })),
  ).flat();
  const results = yield* Effect.forEach(runs, ({ runIndex, scenario }) =>
    evaluateScenario(scenario, {
      generatorCommand,
      input: options.input,
      repeat: options.repeat,
      runIndex,
      useFixture: options.useFixture,
    }).pipe(
      Effect.flatMap((result) => {
        const out = outputPathForScenario({
          out: options.out,
          outDir: options.outDir,
          repeat: options.repeat,
          runIndex,
          scenarioId: scenario.id,
        });
        const candidateOut = candidatePathForScenario({
          candidateOutDir: options.candidateOutDir,
          repeat: options.repeat,
          runIndex,
          scenarioId: scenario.id,
        });
        return Effect.all([
          out ? writeJson(out, result.evaluation.excalidrawScene) : Effect.void,
          candidateOut
            ? writeText(candidateOut, result.candidateOutput)
            : Effect.void,
        ]).pipe(
          Effect.as({
            scenarioId: result.evaluation.scenarioId,
            runIndex,
            runNumber: runIndex + 1,
            ok: result.evaluation.ok,
            checks: result.evaluation.checks,
            excalidrawIssues: result.evaluation.excalidrawValidation.issues,
            candidateOut,
            out,
          }),
        );
      }),
    ),
  );

  const ok = results.every((result) => result.ok);
  const output =
    options.all || options.repeat > 1
      ? {
          ok,
          evaluationCount: results.length,
          repeat: options.repeat,
          scenarioCount: scenarios.length,
          failedScenarioIds: results
            .filter((result) => !result.ok)
            .map((result) => result.scenarioId)
            .filter(
              (scenarioId, index, scenarioIds) =>
                scenarioIds.indexOf(scenarioId) === index,
            ),
          failedEvaluations: results
            .filter((result) => !result.ok)
            .map((result) => ({
              scenarioId: result.scenarioId,
              runNumber: result.runNumber,
            })),
          results,
        }
      : results[0];

  if (options.reportOut) {
    yield* writeJson(options.reportOut, output);
  }
  console.log(JSON.stringify(output, null, 2));
  if (!ok) process.exitCode = 1;
});

export function scenarioCliExitCode(error: { readonly _tag?: string }): number {
  return error._tag === "ScenarioCliUsageError" ? 2 : 1;
}

const main = runScenarioCli(process.argv.slice(2)).pipe(
  Effect.catch((error) =>
    Effect.sync(() => {
      console.error(error.message);
      process.exitCode = scenarioCliExitCode(error);
    }),
  ),
);

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  NodeRuntime.runMain(main.pipe(Effect.provide(ToolProcessSpawnerLive)));
}
