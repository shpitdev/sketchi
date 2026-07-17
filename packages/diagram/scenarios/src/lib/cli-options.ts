export const DEFAULT_GENERATOR_COMMAND_ENV = "SKETCHI_GENERATOR_COMMAND";

export interface CliOptions {
  all: boolean;
  candidateOutDir?: string;
  generatorCommand?: string;
  generatorCommandEnv?: string;
  input?: string;
  list: boolean;
  out?: string;
  outDir?: string;
  repeat: number;
  reportOut?: string;
  scenarioId?: string;
  useFixture: boolean;
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    all: false,
    list: false,
    repeat: 1,
    useFixture: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--list") {
      options.list = true;
      continue;
    }

    if (arg === "--fixture") {
      options.useFixture = true;
      continue;
    }

    if (arg === "--all") {
      options.all = true;
      continue;
    }

    if (arg === "--scenario" && next) {
      options.scenarioId = next;
      index += 1;
      continue;
    }

    if (arg === "--input" && next) {
      options.input = next;
      index += 1;
      continue;
    }

    if (arg === "--generator-command-env" && next) {
      options.generatorCommandEnv = next;
      index += 1;
      continue;
    }

    if (arg === "--candidate-out-dir" && next) {
      options.candidateOutDir = next;
      index += 1;
      continue;
    }

    if (arg === "--report-out" && next) {
      options.reportOut = next;
      index += 1;
      continue;
    }

    if (arg === "--repeat" && next) {
      const repeat = Number.parseInt(next, 10);
      if (!Number.isInteger(repeat) || repeat < 1) {
        throw new Error("--repeat must be a positive integer.");
      }
      options.repeat = repeat;
      index += 1;
      continue;
    }

    if (arg === "--generator-command") {
      const commandParts = argv.slice(index + 1);
      if (commandParts.length === 0) {
        throw new Error(`Unknown or incomplete argument "${arg}".`);
      }
      options.generatorCommand = commandParts.join(" ");
      break;
    }

    if (arg === "--out" && next) {
      options.out = next;
      index += 1;
      continue;
    }

    if (arg === "--out-dir" && next) {
      options.outDir = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument "${arg}".`);
  }

  return options;
}

export function resolveGeneratorCommand(
  options: CliOptions,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (options.generatorCommand) {
    return options.generatorCommand;
  }

  const envName = options.generatorCommandEnv ?? DEFAULT_GENERATOR_COMMAND_ENV;
  const command = env[envName];

  if (options.generatorCommandEnv && !command) {
    throw new Error(`Environment variable "${envName}" is empty or unset.`);
  }

  return command && command.trim().length > 0 ? command : undefined;
}

export function usage(): string {
  return [
    "Usage:",
    "  pnpm nx scenario diagram-scenarios -- --list",
    "  pnpm nx scenario diagram-scenarios -- --all --fixture",
    "  pnpm nx scenario diagram-scenarios -- --all --fixture --out-dir .memory/scenarios",
    "  pnpm nx scenario diagram-scenarios -- --scenario pharma-batch-disposition --fixture --out .memory/pharma.excalidraw",
    "  pnpm nx scenario diagram-scenarios -- --scenario pharma-batch-disposition --input candidate.json",
    '  SKETCHI_GENERATOR_COMMAND="your-llm-command" pnpm nx scenario diagram-scenarios -- --all --repeat 5 --candidate-out-dir .memory/candidates --report-out .memory/report.json',
    "",
    "When --generator-command is used directly, put it last. The scenario prompt is written to stdin, SKETCHI_SCENARIO_ID is set, and JSON IR is expected on stdout.",
  ].join("\n");
}
