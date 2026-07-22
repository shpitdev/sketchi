/**
 * Reviewed boundary for Effect v4 beta's unstable CLI package.
 * No other Sketchi CLI source may import `effect/unstable/cli` directly.
 */
import { Console, Effect } from "effect";
import {
  Argument,
  CliConfig,
  CliError,
  CliOutput,
  Command,
  Flag,
  GlobalFlag,
  Param,
} from "effect/unstable/cli";

export { Argument, Command, Flag };

/** Replaced with the package version by DefinePlugin in the release bundle. */
declare const __SKETCHI_VERSION__: string | undefined;

const cliVersion =
  typeof __SKETCHI_VERSION__ === "string" ? __SKETCHI_VERSION__ : "0.0.0";

const PUBLIC_COMMANDS = new Set(["create", "show", "edit", "list", "export"]);

export type InputSource =
  | { readonly _tag: "File"; readonly path: string }
  | { readonly _tag: "InlineJson"; readonly value: string };

function fileSource(path: string): InputSource {
  return { _tag: "File", path };
}

function inlineSource(value: string): InputSource {
  return { _tag: "InlineJson", value };
}

export function exclusiveInputSourceFlags() {
  const file = Flag.string("file").pipe(
    Flag.withMetavar("PATH|-"),
    Flag.withDescription(
      "Read one canonical document from PATH, or stdin with -.",
    ),
    Flag.map(fileSource),
  );
  const json = Flag.string("json").pipe(
    Flag.withMetavar("VALUE"),
    Flag.withDescription("Read one canonical document from inline JSON."),
    Flag.map(inlineSource),
  );
  const source = Object.assign(
    Object.create(Object.getPrototypeOf(file)),
    file,
    {
      parse: (args: Param.ParsedArgs) => {
        const fileCount = args.flags["file"]?.length ?? 0;
        const jsonCount = args.flags["json"]?.length ?? 0;
        if (fileCount === 1 && jsonCount === 0) return file.parse(args);
        if (fileCount === 0 && jsonCount === 1) return json.parse(args);
        return Effect.fail(
          new CliError.InvalidValue({
            option: "file/--json",
            value:
              fileCount === 0 && jsonCount === 0
                ? "neither provided"
                : "more than one source provided",
            expected: "exactly one of --file PATH|- or --json VALUE",
            kind: "flag",
          }),
        );
      },
    },
  ) as Flag.Flag<InputSource>;
  return {
    source,
    // This optional declaration registers --json in parser metadata and help.
    // `source.parse` owns the exact-one validation and typed result.
    jsonInput: Flag.optional(json),
  };
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
  const jsonOutput =
    args.some((argument) => argument === "--output=json") ||
    args.some(
      (argument, index) =>
        argument === "--output" && args[index + 1] === "json",
    );
  const commandName = args.find((argument) => PUBLIC_COMMANDS.has(argument));
  const errorCommand = commandName ?? "sketchi";
  const formatter: CliOutput.Formatter = {
    ...defaultFormatter,
    formatHelpDoc: (document) =>
      jsonOutput && !usesDocumentationAction
        ? ""
        : defaultFormatter.formatHelpDoc(document).replace(/[ \t]+$/gmu, ""),
    formatErrors: (errors) => {
      const message = errors
        .map((error) => defaultFormatter.formatCliError(error))
        .join("; ");
      const hint = `Run sketchi${commandName ? ` ${commandName}` : ""} --help for usage.`;
      return jsonOutput
        ? `${JSON.stringify(
            {
              ok: false,
              command: errorCommand,
              error: { code: "usage_error", message, hint },
            },
            null,
            2,
          )}\n`
        : `error: usage_error\n${message}\nnext: ${hint}\n`;
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
