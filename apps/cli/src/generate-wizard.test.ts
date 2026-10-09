import { CANCEL_SYMBOL, select, text } from "@clack/prompts";
import { assert, describe, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { vi } from "vitest";

import {
  GenerateWizard,
  GenerateWizardLive,
  makeGenerateWizardTestLayer,
  shouldLaunchGenerateWizard,
  validateCustomDestination,
} from "./generate-wizard.js";

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  intro: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
}));

describe("interactive generate wizard", () => {
  for (const message of [
    "What should Sketchi draw?",
    "Diagram type",
    "Save the PNG",
    "PNG destination",
  ]) {
    it.effect(
      `aborts the ${message} prompt without translating interruption`,
      () =>
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          let signal: AbortSignal | undefined;
          const pendingPrompt = (promptSignal: AbortSignal | undefined) =>
            new Promise<typeof CANCEL_SYMBOL>((resolve) => {
              signal = promptSignal;
              signal?.addEventListener("abort", () => resolve(CANCEL_SYMBOL), {
                once: true,
              });
              Deferred.doneUnsafe(started, Effect.void);
            });
          vi.mocked(text).mockImplementation((options) =>
            options.message === message
              ? pendingPrompt(options.signal)
              : Promise.resolve("Draw a release"),
          );
          vi.mocked(select).mockImplementation((options) =>
            options.message === message
              ? pendingPrompt(options.signal)
              : Promise.resolve(
                  options.message === "Diagram type" ? "flowchart" : "custom",
                ),
          );
          const wizard = yield* GenerateWizard;
          const fiber = yield* wizard.ask({}).pipe(Effect.forkChild);
          yield* Deferred.await(started);
          yield* Fiber.interrupt(fiber);
          const exit = yield* Fiber.await(fiber);
          assert.isTrue(signal?.aborted);
          assert.isTrue(
            Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause),
          );
        }).pipe(Effect.provide(GenerateWizardLive)),
    );
  }
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
