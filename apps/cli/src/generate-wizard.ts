import { cancel, intro, isCancel, select, spinner, text } from "@clack/prompts";
import { Context, Effect, Exit, Layer, type Scope } from "effect";
import isCI from "is-ci";

import type { OutputFormat } from "./contracts.js";
import { CliInteractiveError } from "./errors.js";
import type { GenerationType } from "./generation.js";

export type WizardDestination =
  | { readonly _tag: "CurrentDirectory" }
  | { readonly _tag: "ProjectDiagrams" }
  | { readonly _tag: "Custom"; readonly path: string };

export interface GenerateWizardAnswers {
  readonly prompt: string;
  readonly type: GenerationType;
  readonly destination: WizardDestination;
}

export interface GenerateWizardPresets {
  readonly type?: GenerationType;
  readonly destination?: WizardDestination;
}

export interface GenerationActivity {
  readonly succeed: (message: string) => Effect.Effect<void>;
  readonly fail: (message: string) => Effect.Effect<void>;
}

export class GenerateWizard extends Context.Service<
  GenerateWizard,
  {
    readonly ask: (
      presets: GenerateWizardPresets,
    ) => Effect.Effect<GenerateWizardAnswers, CliInteractiveError>;
    readonly activity: Effect.Effect<GenerationActivity, never, Scope.Scope>;
  }
>()("@sketchi/cli/GenerateWizard") {}

function cancelled(): CliInteractiveError {
  return CliInteractiveError.make({
    code: "cancelled",
    message: "Generation was cancelled.",
    hint: "Run sketchi generate again when you are ready.",
  });
}

function promptFailure(): CliInteractiveError {
  return CliInteractiveError.make({
    code: "prompt_failed",
    message: "Sketchi could not read the interactive prompt.",
    hint: "Retry in a terminal, or pass --prompt for noninteractive use.",
  });
}

function unwrapPrompt<A>(
  value: A | symbol,
): Effect.Effect<A, CliInteractiveError> {
  if (isCancel(value)) {
    return Effect.sync(() => cancel("Generation cancelled.")).pipe(
      Effect.andThen(Effect.fail(cancelled())),
    );
  }
  return Effect.succeed(value);
}

const askText = Effect.tryPromise({
  try: () =>
    text({
      message: "What should Sketchi draw?",
      placeholder: "Map release approval with pass and revise branches",
      validate: (value) =>
        value !== undefined && value.trim().length > 0
          ? undefined
          : "Enter a diagram description.",
    }),
  catch: promptFailure,
}).pipe(Effect.flatMap(unwrapPrompt));

const askType = Effect.tryPromise({
  try: () =>
    select<GenerationType>({
      message: "Diagram type",
      initialValue: "flowchart",
      options: [
        {
          value: "flowchart",
          label: "Flowchart",
          hint: "best for processes and decisions",
        },
        {
          value: "mindmap",
          label: "Mind map",
          hint: "best for ideas and topics",
        },
        {
          value: "sequence",
          label: "Sequence diagram",
          hint: "best for ordered participant interactions",
        },
      ],
    }),
  catch: promptFailure,
}).pipe(Effect.flatMap(unwrapPrompt));

type DestinationChoice = "current" | "project" | "custom";

const askDestinationChoice = Effect.tryPromise({
  try: () =>
    select<DestinationChoice>({
      message: "Save the PNG",
      initialValue: "current",
      options: [
        {
          value: "current",
          label: "Current directory",
          hint: "<generated-id>.png",
        },
        {
          value: "project",
          label: "Project diagrams folder",
          hint: "diagrams/<generated-id>.png",
        },
        {
          value: "custom",
          label: "Custom path",
          hint: "same semantics as --dest",
        },
      ],
    }),
  catch: promptFailure,
}).pipe(Effect.flatMap(unwrapPrompt));

export function validateCustomDestination(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return "Enter a file path.";
  }
  if (value.trim() === "-") {
    return "Interactive generation cannot write PNG bytes to stdout. Enter a file path.";
  }
  return undefined;
}

const askCustomDestination = Effect.tryPromise({
  try: () =>
    text({
      message: "PNG destination",
      placeholder: "./diagram.png",
      validate: validateCustomDestination,
    }),
  catch: promptFailure,
}).pipe(Effect.flatMap(unwrapPrompt));

const askWizardDestination = Effect.fn(
  "sketchi.cli.generateWizard.destination",
)(function* () {
  const destinationChoice = yield* askDestinationChoice;
  const destination: WizardDestination =
    destinationChoice === "current"
      ? { _tag: "CurrentDirectory" }
      : destinationChoice === "project"
        ? { _tag: "ProjectDiagrams" }
        : { _tag: "Custom", path: (yield* askCustomDestination).trim() };
  return destination;
});

const ask = Effect.fn("sketchi.cli.generateWizard.ask")(function* (
  presets: GenerateWizardPresets,
) {
  yield* Effect.sync(() => intro("Create a diagram with Sketchi"));
  const prompt = yield* askText;
  const type = presets.type ?? (yield* askType);
  const destination = presets.destination ?? (yield* askWizardDestination());
  return { prompt: prompt.trim(), type, destination };
});

const activity = Effect.acquireRelease(
  Effect.sync(() => {
    const indicator = spinner({ output: process.stdout });
    let finished = false;
    indicator.start("Sketchi is drawing");
    return {
      succeed: (message: string) =>
        Effect.sync(() => {
          if (finished) return;
          finished = true;
          indicator.stop(message);
        }),
      fail: (message: string) =>
        Effect.sync(() => {
          if (finished) return;
          finished = true;
          indicator.error(message);
        }),
      finish: (exit: Exit.Exit<unknown, unknown>) =>
        Effect.sync(() => {
          if (finished) return;
          finished = true;
          if (Exit.isFailure(exit)) indicator.error("Generation stopped");
          else indicator.clear();
        }),
    };
  }),
  (progress, exit) => progress.finish(exit),
).pipe(
  Effect.map((progress) => ({
    succeed: progress.succeed,
    fail: progress.fail,
  })),
);

export const GenerateWizardLive = Layer.succeed(GenerateWizard, {
  ask,
  activity,
});

export function makeGenerateWizardTestLayer(
  answers: GenerateWizardAnswers,
  events: Array<string> = [],
) {
  return Layer.succeed(GenerateWizard, {
    ask: () => Effect.succeed(answers),
    activity: Effect.succeed({
      succeed: (message: string) =>
        Effect.sync(() => events.push(`success:${message}`)),
      fail: (message: string) =>
        Effect.sync(() => events.push(`failure:${message}`)),
    }),
  });
}

export interface GenerateWizardEnvironment {
  readonly stdinIsTTY: boolean;
  readonly stdoutIsTTY: boolean;
  readonly output: OutputFormat;
  readonly continuousIntegration: boolean;
}

export function shouldLaunchGenerateWizard({
  stdinIsTTY,
  stdoutIsTTY,
  output,
  continuousIntegration,
}: GenerateWizardEnvironment): boolean {
  return (
    stdinIsTTY && stdoutIsTTY && output === "text" && !continuousIntegration
  );
}

export function liveGenerateWizardAvailable(output: OutputFormat): boolean {
  return shouldLaunchGenerateWizard({
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    output,
    continuousIntegration: isCI,
  });
}
