import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  GenerateWizard,
  makeGenerateWizardTestLayer,
  shouldLaunchGenerateWizard,
  validateCustomDestination,
} from "./generate-wizard.js";

describe("interactive generate wizard", () => {
  it.each([
    {
      name: "redirected stdin",
      stdinIsTTY: false,
      stdoutIsTTY: true,
      output: "text" as const,
      continuousIntegration: false,
    },
    {
      name: "redirected stdout",
      stdinIsTTY: true,
      stdoutIsTTY: false,
      output: "text" as const,
      continuousIntegration: false,
    },
    {
      name: "JSON output",
      stdinIsTTY: true,
      stdoutIsTTY: true,
      output: "json" as const,
      continuousIntegration: false,
    },
    {
      name: "continuous integration",
      stdinIsTTY: true,
      stdoutIsTTY: true,
      output: "text" as const,
      continuousIntegration: true,
    },
  ])("does not launch for $name", (input) => {
    assert.isFalse(shouldLaunchGenerateWizard(input));
  });

  it("launches only for human text TTYs", () => {
    assert.isTrue(
      shouldLaunchGenerateWizard({
        stdinIsTTY: true,
        stdoutIsTTY: true,
        output: "text",
        continuousIntegration: false,
      }),
    );
  });

  it("requires an interactive custom destination to be a file path", () => {
    assert.strictEqual(
      validateCustomDestination("-"),
      "Interactive generation cannot write PNG bytes to stdout. Enter a file path.",
    );
    assert.strictEqual(
      validateCustomDestination("  -  "),
      "Interactive generation cannot write PNG bytes to stdout. Enter a file path.",
    );
    assert.strictEqual(validateCustomDestination("./release.png"), undefined);
  });

  const events: Array<string> = [];
  it.layer(
    makeGenerateWizardTestLayer(
      {
        prompt: "Map a release",
        type: "flowchart",
        destination: { _tag: "CurrentDirectory" },
      },
      events,
    ),
  )("test prompt layer", (it) => {
    it.effect("provides answers and scoped progress", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const wizard = yield* GenerateWizard;
          const answers = yield* wizard.ask({
            type: "mindmap",
            destination: { _tag: "Custom", path: "preset.png" },
          });
          const activity = yield* wizard.activity;
          yield* activity.succeed("Diagram ready");

          assert.strictEqual(answers.type, "flowchart");
          assert.deepStrictEqual(events, ["success:Diagram ready"]);
        }),
      ),
    );
  });
});
