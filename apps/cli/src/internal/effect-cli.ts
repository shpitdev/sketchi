/**
 * Reviewed boundary for Effect's stable CLI package.
 * No other Sketchi CLI source may import `effect/cli` directly.
 */
import { Console, Effect, Option } from "effect";
import {
  Argument,
  CliConfig,
  CliError,
  CliOutput,
  Command,
  Flag,
  GlobalFlag,
} from "effect/cli";

import type { OutputFormat } from "../contracts.js";
import { redactShareLinks } from "../redaction.js";
import { renderRootHelp, terminalRootHelp } from "../help-brand.js";

export { Argument, Command, Flag };

/** Replaced with the package version by DefinePlugin in the release bundle. */
declare const __SKETCHI_VERSION__: string | undefined;

const cliVersion =
  typeof __SKETCHI_VERSION__ === "string" ? __SKETCHI_VERSION__ : "0.0.0";

const PUBLIC_COMMANDS = new Set([
  "generate",
  "canvas",
  "docs",
  "create",
  "show",
  "edit",
  "patch",
  "list",
  "restore",
  "share",
  "pull",
  "export",
]);

export type InputSource =
  | { readonly _tag: "File"; readonly path: string }
  | { readonly _tag: "InlineJson"; readonly value: string };

export function exclusiveInputSourceFlags(content = "canonical document") {
  return {
    fileInput: Flag.String("file").pipe(
      Flag.withMetavar("PATH|-"),
      Flag.withDescription(`Read one ${content} from PATH, or stdin with -.`),
      Flag.atLeast(1),
      Flag.optional,
    ),
    jsonInput: Flag.String("json").pipe(
      Flag.withMetavar("VALUE"),
      Flag.withDescription(`Read one ${content} from inline JSON.`),
      Flag.atLeast(1),
      Flag.optional,
    ),
  };
}

export const resolveInputSource = Effect.fn("sketchi.cli.input.source")(
  function* (input: {
    readonly fileInput: Option.Option<ReadonlyArray<string>>;
    readonly jsonInput: Option.Option<ReadonlyArray<string>>;
  }) {
    const files = Option.getOrElse(input.fileInput, () => []);
    const json = Option.getOrElse(input.jsonInput, () => []);
    if (files.length === 1 && json.length === 0)
      return { _tag: "File", path: files[0]! } satisfies InputSource;
    if (files.length === 0 && json.length === 1)
      return { _tag: "InlineJson", value: json[0]! } satisfies InputSource;
    return yield* invalidFlagValue(
      "file/--json",
      files.length === 0 && json.length === 0
        ? "neither provided"
        : "more than one source provided",
      "exactly one of --file PATH|- or --json VALUE",
    );
  },
);

export function exactlyOnceStringFlag(
  name: string,
  metavar: string,
  description: string,
) {
  return Flag.String(name).pipe(
    Flag.withMetavar(metavar),
    Flag.withDescription(description),
    Flag.atLeast(0),
    Flag.mapEffect((values) =>
      values.length === 1
        ? Effect.succeed(values[0]!)
        : Effect.fail(
            invalidFlagValue(
              name,
              values.length === 0 ? "not provided" : "provided more than once",
              `exactly one --${name} ${metavar}`,
            ),
          ),
    ),
  );
}

export function missingRequiredFlag(name: string) {
  return new CliError.MissingOption({ option: name });
}

export function invalidFlagValue(
  name: string,
  value: string,
  expected: string,
) {
  return new CliError.InvalidValue({
    option: name,
    value,
    expected,
    kind: "flag",
  });
}

/** Match the parser: the first --output value wins, before the -- separator. */
export function requestedOutputFormat(
  args: ReadonlyArray<string>,
): OutputFormat {
  for (const [index, argument] of args.entries()) {
    if (argument === "--") break;
    if (argument === "--output")
      return args[index + 1] === "json" ? "json" : "text";
    if (argument.startsWith("--output="))
      return argument === "--output=json" ? "json" : "text";
  }
  return "text";
}

export function runEffectCommand<
  const Name extends string,
  Input,
  ContextInput,
  E,
  R,
>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  args: ReadonlyArray<string>,
) {
  const defaultFormatter = CliOutput.defaultFormatter({ colors: false });
  const usesDocumentationAction = args.some(
    (argument) =>
      argument === "--help" ||
      argument === "-h" ||
      argument === "--version" ||
      argument === "-v",
  );
  const jsonOutput = requestedOutputFormat(args) === "json";
  const commandName = args.find((argument) => PUBLIC_COMMANDS.has(argument));
  const usesOnlyRootOutputFlags = args.every(
    (argument, index) =>
      argument === "--output" ||
      argument === "--output=text" ||
      argument === "--output=json" ||
      (args[index - 1] === "--output" &&
        (argument === "text" || argument === "json")),
  );
  const rootHelp =
    commandName === undefined &&
    (args.length === 0 || usesDocumentationAction || usesOnlyRootOutputFlags);
  const errorCommand = commandName ?? "sketchi";
  const formatter: CliOutput.Formatter = {
    ...defaultFormatter,
    formatHelpDoc: (document) => {
      const help = defaultFormatter
        .formatHelpDoc(document)
        .replace(/[ \t]+$/gmu, "");
      if (jsonOutput && rootHelp) {
        return `${JSON.stringify(
          {
            ok: true,
            command: "sketchi",
            data: {
              help: renderRootHelp({ colors: "none", background: "dark" }),
            },
          },
          null,
          2,
        )}\n`;
      }
      if (jsonOutput && !usesDocumentationAction) return "";
      return rootHelp ? terminalRootHelp() : help;
    },
    formatErrors: (errors) => {
      const message = errors
        .map((error) => defaultFormatter.formatCliError(error))
        .join("; ");
      const hint = `Run sketchi${commandName ? ` ${commandName}` : ""} --help for usage.`;
      return redactShareLinks(
        jsonOutput
          ? `${JSON.stringify(
              {
                ok: false,
                command: errorCommand,
                error: { code: "usage_error", message, hint },
              },
              null,
              2,
            )}\n`
          : `error: usage_error\n${message}\nnext: ${hint}\n`,
      );
    },
  };
  const cliConsole = new Proxy(globalThis.console, {
    get(target, property, receiver) {
      if (property === "log") {
        return (...values: ReadonlyArray<unknown>) => {
          if (values.length === 1 && values[0] === "") return;
          target.log(...values);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Console.Console;
  return Command.runWith(command, { version: cliVersion })(args).pipe(
    Effect.tapError((error) =>
      CliError.isCliError(error) && error._tag !== "ShowHelp"
        ? Console.error(formatter.formatErrors([error]))
        : Effect.void,
    ),
    Effect.provideService(CliConfig.CliConfig, {
      builtIns: [GlobalFlag.Help, GlobalFlag.Version, GlobalFlag.Completions],
    }),
    Effect.provideService(CliOutput.Formatter, formatter),
    Effect.provideService(Console.Console, cliConsole),
  );
}

export function cliErrorExitCode(error: unknown): number | undefined {
  if (!CliError.isCliError(error)) return undefined;
  if (error._tag === "ShowHelp") return error.errors.length > 0 ? 2 : 0;
  return 2;
}
