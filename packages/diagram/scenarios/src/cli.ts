import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseCliOptions,
  resolveGeneratorCommand,
  usage,
} from "./lib/cli-options.js";
import { buildScenarioPrompt } from "./lib/prompt.js";
import {
  evaluateScenarioDiagram,
  evaluateScenarioFixture,
  evaluateScenarioOutput,
} from "./lib/evaluate.js";
import {
  type DiagramScenario,
  flowchartScenarios,
  getScenario,
} from "./lib/scenarios.js";

function runCommand(
  command: string,
  scenario: DiagramScenario,
  stdin: string,
  run: {
    repeat: number;
    runIndex: number;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
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
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const output = Buffer.concat(stdout).toString("utf8");
      if (code === 0) {
        resolve(output);
        return;
      }

      reject(
        new Error(
          `Generator command exited with ${code}.\n${Buffer.concat(stderr).toString("utf8")}`,
        ),
      );
    });

    child.stdin.end(stdin);
  });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function outputPathForScenario(input: {
  out: string | undefined;
  outDir: string | undefined;
  repeat: number;
  runIndex: number;
  scenarioId: string;
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
  candidateOutDir: string | undefined;
  repeat: number;
  runIndex: number;
  scenarioId: string;
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

async function evaluateScenario(
  scenario: DiagramScenario,
  input: {
    generatorCommand: string | undefined;
    input: string | undefined;
    repeat: number;
    runIndex: number;
    useFixture: boolean;
  },
) {
  if (input.useFixture) {
    const candidateOutput = JSON.stringify(scenario.expectedDiagram, null, 2);

    return {
      candidateOutput,
      evaluation: evaluateScenarioFixture(scenario),
    };
  }

  if (input.input) {
    const candidateOutput = await readFile(input.input, "utf8");

    return {
      candidateOutput,
      evaluation: evaluateScenarioDiagram(
        scenario,
        JSON.parse(candidateOutput),
      ),
    };
  }

  if (input.generatorCommand) {
    const candidateOutput = await runCommand(
      input.generatorCommand,
      scenario,
      buildScenarioPrompt(scenario),
      { repeat: input.repeat, runIndex: input.runIndex },
    );

    return {
      candidateOutput,
      evaluation: evaluateScenarioOutput(scenario, candidateOutput),
    };
  }

  return null;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));

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
    throw new Error("--input can only be used with one --scenario.");
  }

  if (options.all && options.out) {
    throw new Error(
      "--out can only be used with one --scenario. Use --out-dir for --all.",
    );
  }

  if (options.repeat > 1 && options.out) {
    throw new Error("--out can only be used with --repeat 1. Use --out-dir.");
  }

  if (!options.all && !options.scenarioId) {
    throw new Error(`Missing --scenario.\n\n${usage()}`);
  }

  const scenarios = options.all
    ? flowchartScenarios
    : [getScenario(options.scenarioId ?? "")];
  const generatorCommand = resolveGeneratorCommand(options);
  const results = [];

  if (!options.useFixture && !options.input && !generatorCommand) {
    throw new Error(
      `Choose --fixture, --input, or --generator-command.\n\n${usage()}`,
    );
  }

  for (let runIndex = 0; runIndex < options.repeat; runIndex += 1) {
    for (const scenario of scenarios) {
      const result = await evaluateScenario(scenario, {
        generatorCommand,
        input: options.input,
        repeat: options.repeat,
        runIndex,
        useFixture: options.useFixture,
      });

      if (!result) {
        throw new Error(
          `Choose --fixture, --input, or --generator-command.\n\n${usage()}`,
        );
      }

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

      if (out) {
        await writeJson(out, result.evaluation.excalidrawScene);
      }

      if (candidateOut) {
        await mkdir(path.dirname(candidateOut), { recursive: true });
        await writeFile(candidateOut, result.candidateOutput);
      }

      results.push({
        scenarioId: result.evaluation.scenarioId,
        runIndex,
        runNumber: runIndex + 1,
        ok: result.evaluation.ok,
        checks: result.evaluation.checks,
        excalidrawIssues: result.evaluation.excalidrawValidation.issues,
        candidateOut,
        out,
      });
    }
  }

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
            .filter((scenarioId, index, scenarioIds) => {
              return scenarioIds.indexOf(scenarioId) === index;
            }),
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
    await writeJson(options.reportOut, output);
  }

  console.log(JSON.stringify(output, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
