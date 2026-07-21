import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";

import {
  runScenarioCli,
  ScenarioCliUsageError,
  scenarioCliExitCode,
} from "./cli.js";
import { ToolProcessSpawnerLive } from "./internal/tool-process.js";

describe("scenario CLI expected failures", () => {
  it.effect("maps an unknown scenario to a typed usage failure", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        runScenarioCli(["--scenario", "unknown-scenario", "--fixture"]).pipe(
          Effect.provide(ToolProcessSpawnerLive),
        ),
      );
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.findError(exit.cause);
        assert.strictEqual(error._tag, "Success");
        if (error._tag === "Success") {
          assert.instanceOf(error.success, ScenarioCliUsageError);
          assert.include(
            error.success.message,
            'Unknown scenario "unknown-scenario"',
          );
          assert.strictEqual(scenarioCliExitCode(error.success), 2);
        }
      }
    }),
  );

  it.effect("maps invalid arguments to the same usage exit", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        runScenarioCli(["--unknown"]).pipe(
          Effect.provide(ToolProcessSpawnerLive),
        ),
      );
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const error = Cause.findError(exit.cause);
        assert.strictEqual(error._tag, "Success");
        if (error._tag === "Success") {
          assert.instanceOf(error.success, ScenarioCliUsageError);
          assert.strictEqual(scenarioCliExitCode(error.success), 2);
        }
      }
    }),
  );

  it.live(
    "maps a missing requested generator environment variable to usage exit 2",
    () =>
      Effect.gen(function* () {
        const variableName = "SKETCHI_TEST_MISSING_GENERATOR_COMMAND";
        const previousValue = process.env[variableName];
        delete process.env[variableName];
        const exit = yield* Effect.exit(
          runScenarioCli([
            "--scenario",
            "sketchi-onboarding-decision-flow",
            "--generator-command-env",
            variableName,
          ]).pipe(Effect.provide(ToolProcessSpawnerLive)),
        ).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (previousValue === undefined) {
                delete process.env[variableName];
              } else {
                process.env[variableName] = previousValue;
              }
            }),
          ),
        );

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.findError(exit.cause);
          assert.strictEqual(error._tag, "Success");
          if (error._tag === "Success") {
            assert.instanceOf(error.success, ScenarioCliUsageError);
            assert.include(error.success.message, variableName);
            assert.strictEqual(scenarioCliExitCode(error.success), 2);
          }
        }
      }),
  );
});
